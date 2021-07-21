/*
 * This file is part of the Zorin Taskbar extension for Zorin OS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */


const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const WindowManager = imports.ui.windowManager;
const ExtensionUtils = imports.misc.extensionUtils;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const PanelManager = Me.imports.panelManager;
const Utils = Me.imports.utils;

const ZORIN_DASH_UUID = 'zorin-dash@zorinos.com';

let panelManager;
let oldDash;
let extensionChangedHandler;
let disabledZorinDash;
let extensionSystem = (Main.extensionManager || imports.ui.extensionSystem);

function init() {
    Convenience.initTranslations(Utils.TRANSLATION_DOMAIN);
    
    //create an object that persists until gnome-shell is restarted, even if the extension is disabled
    Me.persistentStorage = {};
}

function enable() {
    // The Zorin Dash extension might get enabled after this extension
    extensionChangedHandler = extensionSystem.connect('extension-state-changed', (data, extension) => {
        if (extension.uuid === ZORIN_DASH_UUID && extension.state === 1) {
            _enable();
        }
    });

    //create a global object that can emit signals and conveniently expose functionalities to other extensions 
    global.zorinTaskbar = {};
    Signals.addSignalMethods(global.zorinTaskbar);
    
    _enable();
}

function _enable() {
    let zorinDash = Main.extensionManager ?
                     Main.extensionManager.lookup(ZORIN_DASH_UUID) : //gnome-shell >= 3.33.4
                     ExtensionUtils.extensions[ZORIN_DASH_UUID];

    if (zorinDash && zorinDash.stateObj && zorinDash.stateObj.dockManager) {
        // Disable Zorin Dash
        let extensionOrder = (extensionSystem.extensionOrder || extensionSystem._extensionOrder);

        Utils.getStageTheme().get_theme().unload_stylesheet(zorinDash.stylesheet);
        zorinDash.stateObj.disable();
        disabledZorinDash = true;
        zorinDash.state = 2; //ExtensionState.DISABLED
        extensionOrder.splice(extensionOrder.indexOf(ZORIN_DASH_UUID), 1);

        //reset to prevent conflicts with the zorin-dash
        if (panelManager) {
            disable(true);
        }
    }

    if (panelManager) return; //already initialized

    Me.settings = Convenience.getSettings('org.gnome.shell.extensions.zorin-taskbar');
    Me.desktopSettings = Convenience.getSettings('org.gnome.desktop.interface');

    panelManager = new PanelManager.dtpPanelManager();

    panelManager.enable();
    
    Utils.removeKeybinding('open-application-menu');
    Utils.addKeybinding(
        'open-application-menu',
        new Gio.Settings({ schema_id: WindowManager.SHELL_KEYBINDINGS_SCHEMA }),
        Lang.bind(this, function() {
            panelManager.primaryPanel.taskbar.popupFocusedAppSecondaryMenu();
        }),
        Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP
    );

    // Pretend I'm the dash: meant to make appgrd swarm animation come from the
    // right position of the appShowButton.
    oldDash = Main.overview._dash;
    Main.overview._dash = panelManager.primaryPanel.taskbar;
}

function disable(reset) {
    panelManager.disable();
    Main.overview._dash = oldDash;
    Me.settings.run_dispose();
    Me.desktopSettings.run_dispose();

    delete Me.settings;
    oldDash = null;
    panelManager = null;
    
    Utils.removeKeybinding('open-application-menu');
    Utils.addKeybinding(
        'open-application-menu',
        new Gio.Settings({ schema_id: WindowManager.SHELL_KEYBINDINGS_SCHEMA }),
        Lang.bind(Main.wm, Main.wm._toggleAppMenu),
        Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP
    );

    if (!reset) {
        extensionSystem.disconnect(extensionChangedHandler);
        delete global.zorinTaskbar;

        // Re-enable Zorin Dash if it was disabled by Zorin Taskbar
        if (disabledZorinDash && Main.sessionMode.allowExtensions) {
            (extensionSystem._callExtensionEnable || extensionSystem.enableExtension).call(extensionSystem, ZORIN_DASH_UUID);
        }
    }
}
