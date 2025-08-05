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

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Shell from 'gi://Shell'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { EventEmitter } from 'resource:///org/gnome/shell/misc/signals.js'
import {
  Extension,
  gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js'
import * as PanelSettings from './panelSettings.js'

import * as PanelManager from './panelManager.js'
import * as AppIcons from './appIcons.js'
import * as Utils from './utils.js'

const ZORIN_DASH_UUID = 'zorin-dash@zorinos.com'
export const ZORIN_TILING_SHELL_UUID = 'zorin-tiling-shell@zorinos.com'

let panelManager
let zorinDashDelayId = 0

export let DTP_EXTENSION = null
export let SETTINGS = null
export let TILINGSETTINGS = null
export let SHELLSETTINGS = null
export let DESKTOPSETTINGS = null
export let TERMINALSETTINGS = null
export let NOTIFICATIONSSETTINGS = null
export let PERSISTENTSTORAGE = null
export let EXTENSION_PATH = null
export let tracker = null

export default class ZorinTaskbarExtension extends Extension {
  constructor(metadata) {
    super(metadata)

    //create an object that persists until gnome-shell is restarted, even if the extension is disabled
    PERSISTENTSTORAGE = {}
  }

  async enable() {
    DTP_EXTENSION = this
    SETTINGS = this.getSettings('org.gnome.shell.extensions.zorin-taskbar')
    try {
      TILINGSETTINGS = new Gio.Settings({
        schema_id: 'org.gnome.shell.extensions.zorin-tiling-shell',
      })
    } catch (e) {
      console.log(e)
    }
    SHELLSETTINGS = new Gio.Settings({
      schema_id: 'org.gnome.shell',
    })
    DESKTOPSETTINGS = new Gio.Settings({
      schema_id: 'org.gnome.desktop.interface',
    })
    TERMINALSETTINGS = new Gio.Settings({
      schema_id: 'org.gnome.desktop.default-applications.terminal',
    })
    NOTIFICATIONSSETTINGS = new Gio.Settings({
      schema_id: 'org.gnome.desktop.notifications',
    })
    EXTENSION_PATH = this.path

    tracker = Shell.WindowTracker.get_default()

    //create a global object that can emit signals and conveniently expose functionalities to other extensions
    global.zorinTaskbar = new EventEmitter()

    await PanelSettings.init(SETTINGS)

    // To remove later, try to map settings using monitor indexes to monitor ids
    PanelSettings.adjustMonitorSettings(SETTINGS)

    this.enableGlobalStyles()

    let completeEnable = () => {
      panelManager = new PanelManager.PanelManager()
      panelManager.enable()
      zorinDashDelayId = 0

      return GLib.SOURCE_REMOVE
    }

    // disable Zorin Dash if present
    if (Main.extensionManager._extensionOrder.indexOf(ZORIN_DASH_UUID) >= 0) {
      let disabled = global.settings.get_strv('disabled-extensions')

      if (disabled.indexOf(ZORIN_DASH_UUID) < 0) {
        disabled.push(ZORIN_DASH_UUID)
        global.settings.set_strv('disabled-extensions', disabled)

        // wait a bit so Zorin Dash can disable itself and restore the showappsbutton
        zorinDashDelayId = GLib.timeout_add(
          GLib.PRIORITY_DEFAULT,
          200,
          completeEnable,
        )
      }
    } else completeEnable()
  }

  disable() {
    if (zorinDashDelayId) GLib.Source.remove(zorinDashDelayId)
    zorinDashDelayId = 0

    panelManager?.disable()

    DTP_EXTENSION = null
    SETTINGS = null
    TILINGSETTINGS = null
    SHELLSETTINGS = null
    DESKTOPSETTINGS = null
    TERMINALSETTINGS = null
    NOTIFICATIONSSETTINGS = null
    panelManager = null
    tracker = null

    delete global.zorinTaskbar

    this.disableGlobalStyles()

    AppIcons.resetRecentlyClickedApp()
  }

  resetGlobalStyles() {
    this.disableGlobalStyles()
    this.enableGlobalStyles()
  }

  enableGlobalStyles() {
    let globalBorderRadius = SETTINGS.get_int('global-border-radius')

    if (globalBorderRadius)
      Main.layoutManager.uiGroup.add_style_class_name(
        `br${globalBorderRadius * 5}`,
      )
  }

  disableGlobalStyles() {
    ;['br5', 'br10', 'br15', 'br20', 'br25'].forEach((c) =>
      Main.layoutManager.uiGroup.remove_style_class_name(c),
    )
  }
}
