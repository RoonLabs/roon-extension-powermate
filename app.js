"use strict";

var PowerMate        = require("node-powermate"),
    RoonApi          = require("node-roon-api"),
    RoonApiSettings  = require('node-roon-api-settings'),
    RoonApiStatus    = require('node-roon-api-status'),
    RoonApiTransport = require('node-roon-api-transport');

var playingstate = '';
var core;
var roon = new RoonApi({
    extension_id:        'com.roonlabs.griffinpowermate.controller',
    display_name:        'Griffin Powermate USB controller',
    display_version:     "1.0.0",
    publisher:           'Roon Labs, LLC',
    email:               'contact@roonlabs.com',
    website:             'https://github.com/RoonLabs/roon-extension-powermate',

    core_paired: function(core_) {
        core = core_;

        let transport = core.services.RoonApiTransport;
        transport.subscribe_zones(function(cmd, data) {
	    try {
		if (cmd == "Changed" && data['zones_changed']) {
		    data.zones_changed.forEach(z => {
			if (z.outputs) {
			    let found = false;
			    z.outputs.forEach(o => { console.log(o.output_id, mysettings.zone.output_id); found = found || o.output_id == mysettings.zone.output_id; });
			    if (found) {
				if (playingstate != z.state) {
				    playingstate = z.state;
				    update_led();
				}
			    }
			}
		    });
		}
	    } catch (e) {
	    }
	});
    },
    core_unpaired: function(core_) {
	core = undefined;
    }
});

var mysettings = Object.assign({
    hiddriver:        'hidraw',
    zone:             null,
    pressaction:      "togglemute",
    longpressaction:  "stop",
    longpresstimeout: 500,
    rotateaction:     "volume",
    led:              "on",
    seekamount:       5,
    rotationdampener: 1
}, roon.load_config("settings") || {});

function makelayout(settings) {
    var l = {
        values:    settings,
	layout:    [],
	has_error: false
    };

    l.layout.push({
	type:    "zone",
	title:   "Zone",
	setting: "zone",
    });

    l.layout.push({
	type:    "dropdown",
	title:   "HID Driver",
	values:  [
	    { title: "HID Raw", value: "hidraw" },
	    { title: "LibUSB",  value: "libusb" },
	],
	setting: "hiddriver",
    });

    l.layout.push({
	type:    "dropdown",
	title:   "LED Status",
	values:  [
	    { title: "Always On",        value: "on" },
	    { title: "On when playing",  value: "whenplaying" },
	    { title: "Off",              value: "off" },
	],
	setting: "led",
    });
    l.layout.push({
	type:    "dropdown",
	title:   "Press Action",
	values:  [
	    { title: "Toggle Play/Pause", value: "toggleplay" },
	    { title: "Toggle Mute",       value: "togglemute" },
	    { title: "Stop Playback",     value: "stop"       },
	    { title: "Standby",           value: "standby"    },
	    { title: "Nothing",           value: "none"       },
	],
	setting: "pressaction",
    });

    l.layout.push({
	type:     "dropdown",
	title:    "Long Press Action",
	values:  [
	    { title: "Toggle Play/Pause", value: "toggleplay" },
	    { title: "Toggle Mute",       value: "togglemute" },
	    { title: "Stop Playback",     value: "stop"       },
	    { title: "Standby",           value: "standby"    },
	    { title: "Nothing",           value: "none"       },
	],
	setting: "longpressaction",
    });

    if (settings.longpressaction != "none") {
	let v = {
	    type:    "integer",
	    min:     100,
	    max:     2000,
	    title:   "Long Press Timeout (milliseconds)",
            subtitle: "This is how long you have to hold the button down to register as a long press.",
	    setting: "longpresstimeout",
	};
	if (settings.longpresstimeout < v.min || settings.longpresstimeout > v.max) {
	    v.error = "Long Press Timeout must be between 100 and 2000 milliseconds.";
	    l.has_error = true; 
	}
        l.layout.push(v);
    }

    l.layout.push({
	type:    "dropdown",
	title:   "Rotation Action",
	values:  [
	    { title: "Change Volume", value: "volume"  },
	    { title: "Seek Position", value: "seek"    },
	    { title: "Nothing",       value: "none"    },
	],
	setting: "rotateaction",
    });

    if (settings.rotateaction == "seek") {
	let v = {
	    type:    "integer",
	    min:     1,
	    max:     60,
	    title:   "Seek Amount (seconds)",
	    setting: "seekamount",
	};
	if (settings.seekamount < 1 || settings.seekamount > 60) {
	    v.error = "Seek Amount must be between 1 and 60 seconds.";
	    l.has_error = true; 
	}
        l.layout.push(v);
    }

    if (settings.rotateaction != "none") {
	    l.layout.push({
		type:     "dropdown",
		title:    "Rotation Dampener",
		values:  [
		    { title: "None",           value: 1       },
		    { title: "Some",           value: 3       },
		    { title: "More",           value: 5       },
		    { title: "Most",           value: 7       },
		],
		setting: "rotationdampener",
	    });
	}

    return l;
}

var svc_settings = new RoonApiSettings(roon, {
    get_settings: function(cb) {
        cb(makelayout(mysettings));
    },
    save_settings: function(req, isdryrun, settings) {
	let l = makelayout(settings.values);
        req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

        if (!isdryrun && !l.has_error) {
            mysettings = l.values;
            svc_settings.update_settings(l);
            roon.save_config("settings", mysettings);
	    update_led();
        }
    }
});

var svc_status = new RoonApiStatus(roon);

roon.init_services({
    required_services:   [ RoonApiTransport ],
    provided_services:   [ svc_settings, svc_status ],
});

function update_status() {
    if (powermate.hid)
	svc_status.set_status("Connected to 1 USB device.", false);
    else
	svc_status.set_status("Could not find USB device.", true)
}

var powermate = { };

function setup_powermate() {
    if (powermate.hid) {
        powermate.hid.close();
	powermate.hid = undefined;
    }

    try {
        powermate.hid = new PowerMate({ hidDriver: mysettings.hiddriver });
        powermate.hid.on('buttonDown', ev_buttondown);
        powermate.hid.on('buttonUp', ev_buttonup);
        powermate.hid.on('wheelTurn',  ev_wheelturn);
        powermate.hid.on('disconnected', () => { delete(powermate.hid); update_status(); });
	update_status();
    } catch (e) {
//	console.log(e);
    }
}

function update_led() {
    if (powermate.hid) {
	if (mysettings.led == "on") {
	    powermate.hid.setBrightness(255);
        } else if (mysettings.led == "whenplaying") {
	    if (playingstate == "playing")
		powermate.hid.setBrightness(255);
	    else
		powermate.hid.setBrightness(0);
        } else {
	    powermate.hid.setBrightness(0);
	}
    }
}

var pressseq = 0;
var ignoreup;

function ev_buttondown() {
    console.log('powermate clickdown');
    var seq = ++pressseq;
    ignoreup = false;
    setTimeout(() => {
        if (seq != pressseq) return;
	console.log('powermate longpress');
        ignoreup = true;
        if (!core) return;
	if      (mysettings.longpressaction == "toggleplay") core.services.RoonApiTransport.control(mysettings.zone, 'playpause');
	else if (mysettings.longpressaction == "stop")       core.services.RoonApiTransport.control(mysettings.zone, 'stop');
	else if (mysettings.longpressaction == "togglemute") core.services.RoonApiTransport.mute(mysettings.zone, 'toggle');
	else if (mysettings.longpressaction == "standby")    core.services.RoonApiTransport.standby(mysettings.zone);
    }, mysettings.longpresstimeout);
}

function ev_buttonup() {
    console.log('powermate clickup');
    pressseq++;
    if (!core) return;
    if (ignoreup) return;
    console.log('powermate press');
    if      (mysettings.pressaction == "toggleplay")  core.services.RoonApiTransport.control(mysettings.zone, 'playpause');
    else if (mysettings.pressaction == "stop")        core.services.RoonApiTransport.control(mysettings.zone, 'stop');
    else if (mysettings.pressaction == "togglemute")  core.services.RoonApiTransport.mute(mysettings.zone, 'toggle');
    else if (mysettings.longpressaction == "standby") core.services.RoonApiTransport.standby(mysettings.zone);
}

let wheelpostime = 0;
let wheelpos = 0;
function ev_wheelturn(delta) {
    let now = (new Date()).getTime();
    if (!wheelpostime || (now - wheelpostime) > 750) {
	wheelpos = delta;
    } else {
        wheelpos += delta;
    }
    wheelpostime = now;

    let t = wheelpos / mysettings.rotationdampener;
    if (t >= 1 || t <= -1) {
        if (t > 0)
	    t = Math.floor(t);
	else
            t = Math.ceil(t);
       wheelpos -= t * mysettings.rotationdampener;

	console.log('powermate turned', t);
	if (!core) return;
	if (!mysettings.zone) return;
	if      (mysettings.rotateaction == "volume") core.services.RoonApiTransport.change_volume(mysettings.zone, 'relative_step', t);
	else if (mysettings.rotateaction == "seek") core.services.RoonApiTransport.seek(mysettings.zone, 'relative', t * mysettings.seekamount);

    }
}

setup_powermate();
update_status();
setInterval(() => { if (!powermate.hid) setup_powermate(); }, 1000);

roon.start_discovery();
