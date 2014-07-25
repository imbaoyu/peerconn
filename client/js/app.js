// Define global variables for JSHint
/*global angular, require, window*/

var windowFocus;

(function () {
    'use strict';

    // Declare app level module 
    angular.module('myApp', ['ui']);

    $(window).focus(function () {
        windowFocus = true;
    })
    .blur(function () {
        windowFocus = false;
    });

    window.onload = function() {
        $(".loading").hide();
        $('.content').stop().animate({
            opacity : 1
        });

        // node-webkit specific
        if (typeof(process) === 'object') {
            // Load library
            var gui = require('nw.gui');

            // Show window
            gui.Window.get().show();

            // Reference to window and tray
            var win = gui.Window.get();
            var tray;

            // Get the minimize event
            win.on('minimize', function() {
                // Hide window
                this.hide();

                // Show tray
                tray = new gui.Tray({ icon: 'img/webrtc.png' });

                // Give it a menu
                var menu = new gui.Menu();
                menu.append(new gui.MenuItem({ type: 'checkbox', label: 'box1' }));
                menu.append(new gui.MenuItem({ label: 'Item A' }));
                menu.append(new gui.MenuItem({ label: 'Item B' }));
                menu.append(new gui.MenuItem({ type: 'separator' }));
                menu.append(new gui.MenuItem({ label: 'Item C' }));

                tray.menu = menu;

                // Show window and remove tray when clicked
                tray.on('click', function() {
                    win.show();
                    this.remove();
                    tray = null;
                });
            });

        }
    };
}());
