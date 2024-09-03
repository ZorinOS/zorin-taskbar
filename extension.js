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
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const WindowManager = imports.ui.windowManager;
const ExtensionUtils = imports.misc.extensionUtils;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const Me = ExtensionUtils.getCurrentExtension();
const { PanelManager } = Me.imports.panelManager;
const Utils = Me.imports.utils;
const AppIcons = Me.imports.appIcons;

const ZORIN_DASH_UUID = 'zorin-dash@zorinos.com';

let panelManager;
let extensionChangedHandler;
let disabledZorinDash;
let extensionSystem = (Main.extensionManager || imports.ui.extensionSystem);

function init() {
    this._realHasOverview = Main.sessionMode.hasOverview;

    ExtensionUtils.initTranslations(Utils.TRANSLATION_DOMAIN);
    
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

        //reset to prevent conflicts with the Zorin Dash
        if (panelManager) {
            disable(true);
        }
    }

    if (panelManager) return; //already initialized

    Me.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.zorin-taskbar');
    Me.desktopSettings = ExtensionUtils.getSettings('org.gnome.desktop.interface');

    Main.layoutManager.startInOverview = false;

    if (Main.layoutManager._startingUp) {
        Main.sessionMode.hasOverview = false;
        Main.layoutManager.connect('startup-complete', () => {
            Main.sessionMode.hasOverview = this._realHasOverview
        });
    }

    panelManager = new PanelManager();

    panelManager.enable();
    
    Utils.removeKeybinding('open-application-menu');
    Utils.addKeybinding(
        'open-application-menu',
        new Gio.Settings({ schema_id: WindowManager.SHELL_KEYBINDINGS_SCHEMA }),
        () => {
            panelManager.primaryPanel.taskbar.popupFocusedAppSecondaryMenu();
        },
        Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP
    );
}

function disable(reset) {
    panelManager.disable();
    Me.settings.run_dispose();
    Me.desktopSettings.run_dispose();

    delete Me.settings;
    panelManager = null;
    
    Utils.removeKeybinding('open-application-menu');
    Utils.addKeybinding(
        'open-application-menu',
        new Gio.Settings({ schema_id: WindowManager.SHELL_KEYBINDINGS_SCHEMA }),
        Main.wm._toggleAppMenu.bind(Main.wm),
        Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP
    );

    if (!reset) {
        extensionSystem.disconnect(extensionChangedHandler);
        delete global.zorinTaskbar;

        // Re-enable Zorin Dash if it was disabled by dash to panel
        if (disabledZorinDash && Main.sessionMode.allowExtensions) {
            (extensionSystem._callExtensionEnable || extensionSystem.enableExtension).call(extensionSystem, ZORIN_DASH_UUID);
        }

        AppIcons.resetRecentlyClickedApp();
    }

    Main.sessionMode.hasOverview = this._realHasOverview;
}
