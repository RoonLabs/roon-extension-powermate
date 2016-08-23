"use strict";

var PowerMate        = require("node-powermate"),
    RoonApi          = require("node-roon-api"),
    RoonApiSettings  = require('node-roon-api-settings'),
    RoonApiStatus    = require('node-roon-api-status'),
    RoonApiTransport = require('node-roon-api-transport');

var core;
var roon = new RoonApi();

var mysettings = roon.load_config("settings") || {
    zone:             null,
    pressaction:      "togglemute",
    longpressaction:  "stop",
    longpresstimeout: 500,
    rotateaction:     "volume",
    seekamount:       5
};

function makelayout(settings) {
    var l = {
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
	title:   "Press Action",
	values:  [
	    { title: "Toggle Play/Pause", value: "toggleplay" },
	    { title: "Toggle Mute",       value: "togglemute" },
	    { title: "Stop Playback",     value: "stop"       },
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
	    { title: "Change Volume",      value: "volume"  },
	    { title: "Seek Song Position", value: "seek"    },
	    { title: "Nothing",            value: "none"    },
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

    return l;
}

var svc_settings = new RoonApiSettings(roon, {
    get_settings: function(cb) {
        cb(mysettings, makelayout(mysettings).layout);
    },
    save_settings: function(req, isdryrun, settings) {
	let l = makelayout(settings);
	if (l.has_error) {
	    req.send_complete("NotValid", { settings: settings, layout: l.layout });
            return;
        }
        req.send_complete("Success", { settings: settings, layout: l.layout });
        if (!isdryrun) {
            mysettings = settings;
            svc_settings.set_settings(mysettings, l.layout);
            roon.save_config("settings", mysettings);
        }
    }
});

var svc_status = new RoonApiStatus(roon);

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
        powermate.hid = new PowerMate();
        powermate.hid.on('buttonDown', ev_buttondown);
        powermate.hid.on('buttonUp', ev_buttonup);
        powermate.hid.on('wheelTurn',  ev_wheelturn);
        powermate.hid.on('disconnected', () => { delete(powermate.hid); update_status(); });
	update_status();
    } catch (e) {
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
    }, mysettings.longpresstimeout);
}

function ev_buttonup() {
    console.log('powermate clickup');
    pressseq++;
    if (!core) return;
    if (ignoreup) return;
    console.log('powermate press');
    if      (mysettings.pressaction == "toggleplay") core.services.RoonApiTransport.control(mysettings.zone, 'playpause');
    else if (mysettings.pressaction == "stop")       core.services.RoonApiTransport.control(mysettings.zone, 'stop');
    else if (mysettings.pressaction == "togglemute") core.services.RoonApiTransport.mute(mysettings.zone, 'toggle');
}

function ev_wheelturn(delta) {
    console.log('powermate turned', delta);
    if (!core) return;
    if      (mysettings.rotateaction == "volume") core.services.RoonApiTransport.change_volume(mysettings.zone, 'relative_step', delta);
    else if (mysettings.rotateaction == "seek") core.services.RoonApiTransport.seek(mysettings.zone, 'relative', delta * mysettings.seekamount);
}

setup_powermate();
update_status();
setInterval(() => { if (!powermate.hid) setup_powermate(); }, 1000);

var extension = roon.extension({
    extension_id:        'com.roonlabs.griffinpowermate.controller',
    display_name:        'Griffin Powermate USB controller',
    display_version:     "1.0.0",
    publisher:           'Roon Labs, LLC',
    email:               'contact@roonlabs.com',
    website:             'https://github.com/RoonLabs/roon-extension-powermate',
    required_services:   [ RoonApiTransport ],
    optional_services:   [ ],
    provided_services:   [ svc_settings, svc_status ],

    core_paired: function(core_) {
        core = core_;
    },
    core_unpaired: function(core_) {
	core = undefined;
    }
});

var go;
go = function() { extension.connect("localhost:9100", () => setTimeout(go, 3000)); };
go();
