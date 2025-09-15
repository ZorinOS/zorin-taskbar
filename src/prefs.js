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
 *
 * Credits:
 * This file is based on code from the Dash to Dock extension by micheleg
 * and code from the Dash to Panel extension
 * Some code was also adapted from the upstream Gnome Shell source code.
 */

import Adw from 'gi://Adw'
import GdkPixbuf from 'gi://GdkPixbuf'
import Gio from 'gi://Gio'
import GioUnix from 'gi://GioUnix'
import GLib from 'gi://GLib'
import GObject from 'gi://GObject'
import Gtk from 'gi://Gtk'
import Gdk from 'gi://Gdk'

import * as PanelSettings from './panelSettings.js'
import * as Pos from './panelPositions.js'

import {
  ExtensionPreferences,
  gettext as _,
  ngettext,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

const SCALE_UPDATE_TIMEOUT = 500
const DEFAULT_PANEL_SIZES = [ 96, 64, 48, 32, 24 ]
const DEFAULT_MARGIN_SIZES = [32, 24, 16, 12, 8, 4, 0]
// Minimum length could be 0, but a higher value may help prevent confusion about where the panel went.
const LENGTH_MARKS = [100, 90, 80, 70, 60, 50, 40, 30, 20]

const SCHEMA_PATH = '/org.gnome.shell.extensions.zorin-taskbar/'

/**
 * This function was copied from the activities-config extension
 * https://github.com/nls1729/acme-code/tree/master/activities-config
 * by Norman L. Smith.
 */
function cssHexString(css) {
  let rrggbb = '#'
  let start
  for (let loop = 0; loop < 3; loop++) {
    let end = 0
    let xx = ''
    for (let loop = 0; loop < 2; loop++) {
      while (true) {
        let x = css.slice(end, end + 1)
        if (x == '(' || x == ',' || x == ')') break
        end++
      }
      if (loop == 0) {
        end++
        start = end
      }
    }
    xx = parseInt(css.slice(start, end)).toString(16)
    if (xx.length == 1) xx = '0' + xx
    rrggbb += xx
    css = css.slice(end)
  }
  return rrggbb
}

function setShortcut(settings, shortcutName) {
  let shortcut_text = settings.get_string(shortcutName + '-text')
  let [success, key, mods] = Gtk.accelerator_parse(shortcut_text)

  if (success && Gtk.accelerator_valid(key, mods)) {
    let shortcut = Gtk.accelerator_name(key, mods)
    settings.set_strv(shortcutName, [shortcut])
  } else {
    settings.set_strv(shortcutName, [])
  }
}

function checkHotkeyPrefix(settings) {
  settings.delay()

  let hotkeyPrefix = settings.get_string('hotkey-prefix-text')
  if (hotkeyPrefix == 'Super') hotkeyPrefix = '<Super>'
  else if (hotkeyPrefix == 'SuperAlt') hotkeyPrefix = '<Super><Alt>'
  let [, , mods] = Gtk.accelerator_parse(hotkeyPrefix)
  let [, , shift_mods] = Gtk.accelerator_parse('<Shift>' + hotkeyPrefix)
  let [, , ctrl_mods] = Gtk.accelerator_parse('<Ctrl>' + hotkeyPrefix)

  let numHotkeys = 10
  for (let i = 1; i <= numHotkeys; i++) {
    let number = i
    if (number == 10) number = 0
    let key = Gdk.keyval_from_name(number.toString())
    let key_kp = Gdk.keyval_from_name('KP_' + number.toString())
    if (Gtk.accelerator_valid(key, mods)) {
      let shortcut = Gtk.accelerator_name(key, mods)
      let shortcut_kp = Gtk.accelerator_name(key_kp, mods)

      // Setup shortcut strings
      settings.set_strv('app-hotkey-' + i, [shortcut])
      settings.set_strv('app-hotkey-kp-' + i, [shortcut_kp])

      // With <Shift>
      shortcut = Gtk.accelerator_name(key, shift_mods)
      shortcut_kp = Gtk.accelerator_name(key_kp, shift_mods)
      settings.set_strv('app-shift-hotkey-' + i, [shortcut])
      settings.set_strv('app-shift-hotkey-kp-' + i, [shortcut_kp])

      // With <Control>
      shortcut = Gtk.accelerator_name(key, ctrl_mods)
      shortcut_kp = Gtk.accelerator_name(key_kp, ctrl_mods)
      settings.set_strv('app-ctrl-hotkey-' + i, [shortcut])
      settings.set_strv('app-ctrl-hotkey-kp-' + i, [shortcut_kp])
    } else {
      // Reset default settings for the relevant keys if the
      // accelerators are invalid
      let keys = [
        'app-hotkey-' + i,
        'app-shift-hotkey-' + i,
        'app-ctrl-hotkey-' + i, // Regular numbers
        'app-hotkey-kp-' + i,
        'app-shift-hotkey-kp-' + i,
        'app-ctrl-hotkey-kp-' + i,
      ] // Key-pad numbers
      keys.forEach(function (val) {
        settings.set_value(val, settings.get_default_value(val))
      }, this)
    }
  }

  settings.apply()
}

const Preferences = class {
  constructor(window, settings, gnomeInterfaceSettings, path) {
    // this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.zorin-taskbar');
    this._rtl = Gtk.Widget.get_default_direction() == Gtk.TextDirection.RTL
    this._builder = new Gtk.Builder()
    this._builder.set_scope(new BuilderScope(this))
    this._settings = settings
    this._gnomeInterfaceSettings = gnomeInterfaceSettings
    this._path = path

    this._metadata = ExtensionPreferences.lookupByURL(import.meta.url).metadata
    this._builder.set_translation_domain(this._metadata['gettext-domain'])

    window.set_search_enabled(true)

    // dialogs
    this._builder.add_from_file(this._path + '/ui/BoxShowDesktopOptions.ui')
    this._builder.add_from_file(this._path + '/ui/BoxDynamicOpacityOptions.ui')
    this._builder.add_from_file(this._path + '/ui/BoxIntellihideOptions.ui')
    this._builder.add_from_file(
      this._path + '/ui/BoxShowDateMenuOptions.ui',
    )
    this._builder.add_from_file(this._path + '/ui/BoxWindowPreviewOptions.ui')
    this._builder.add_from_file(this._path + '/ui/BoxGroupAppsOptions.ui')
    this._builder.add_from_file(this._path + '/ui/BoxMiddleClickOptions.ui')
    this._builder.add_from_file(this._path + '/ui/BoxOverlayShortcut.ui')

    // pages
    this._builder.add_from_file(this._path + '/ui/SettingsStyle.ui')
    let pageStyle = this._builder.get_object('style')
    window.add(pageStyle)

    this._builder.add_from_file(this._path + '/ui/SettingsPosition.ui')
    let pagePosition = this._builder.get_object('position')
    window.add(pagePosition)

    this._builder.add_from_file(this._path + '/ui/SettingsBehavior.ui')
    let pageBehavior = this._builder.get_object('behavior')
    window.add(pageBehavior)

    this._builder.add_from_file(this._path + '/ui/SettingsAction.ui')
    let pageAction = this._builder.get_object('action')
    window.add(pageAction)

    let listbox = this._builder.get_object('taskbar_display_listbox')
    let provider = new Gtk.CssProvider()
    provider.load_from_data('list { background-color: transparent; }', -1)
    let context = listbox.get_style_context()
    context.add_provider(provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

    // set the window as notebook, it is being used as parent for dialogs
    this.notebook = window

    PanelSettings.setMonitorsInfo(settings).then(() => {
      this._bindSettings()

      PanelSettings.displayConfigProxy.connectSignal(
        'MonitorsChanged',
        async () => {
          await PanelSettings.setMonitorsInfo(settings)
          this._setMonitorsInfo()
        },
      )

      let maybeGoToPage = () => {
        let targetPageName = settings.get_string('target-prefs-page')

        if (targetPageName) {
          window.set_visible_page_name(targetPageName)
          settings.set_string('target-prefs-page', '')
        }
      }

      settings.connect('changed::target-prefs-page', maybeGoToPage)

      maybeGoToPage()
    })
  }

  /**
   * Connect signals
   */
  _connector(builder, object, signal, handler) {
    object.connect(signal, this._SignalHandler[handler].bind(this))
  }

  _updateVerticalRelatedOptions() {
    let position = this._getPanelPosition(this._currentMonitorIndex)
    let isVertical = position == Pos.LEFT || position == Pos.RIGHT
    let showDesktopWidthLabel = this._builder.get_object(
      'show_showdesktop_width_label',
    )

    showDesktopWidthLabel.set_title(_('Show Desktop button padding (px)'))

    this._displayPanelPositionsForMonitor(this._currentMonitorIndex)
    this._setPanelLenghtWidgetSensitivity(
      PanelSettings.getPanelLength(this._settings, this._currentMonitorIndex),
    )
  }

  _getPanelPosition(monitorIndex) {
    return PanelSettings.getPanelPosition(this._settings, monitorIndex)
  }

  _setPanelPosition(position) {
    const monitorSync = this._settings.get_boolean(
      'panel-element-positions-monitors-sync',
    )
    const monitorsToSetFor = monitorSync
      ? Object.keys(this.monitors)
      : [this._currentMonitorIndex]
    monitorsToSetFor.forEach((monitorIndex) => {
      PanelSettings.setPanelPosition(this._settings, monitorIndex, position)
    })
    this._setAnchorLabels(this._currentMonitorIndex)
  }

  _setPositionRadios(position) {
    this._ignorePositionRadios = true

    switch (position) {
      case Pos.BOTTOM:
        this._builder.get_object('position_bottom_button').set_active(true)
        break
      case Pos.TOP:
        this._builder.get_object('position_top_button').set_active(true)
        break
      case Pos.LEFT:
        this._builder.get_object('position_left_button').set_active(true)
        break
      case Pos.RIGHT:
        this._builder.get_object('position_right_button').set_active(true)
        break
    }

    this._ignorePositionRadios = false
  }

  /**
   * Set panel anchor combo labels according to whether the monitor's panel is vertical
   * or horizontal, or if all monitors' panels are being configured and they are a mix
   * of vertical and horizontal.
   */
  _setAnchorLabels(currentMonitorIndex) {
    const monitorSync = this._settings.get_boolean(
      'panel-element-positions-monitors-sync',
    )
    const monitorsToSetFor = monitorSync
      ? Object.keys(this.monitors)
      : [currentMonitorIndex]
    const allVertical = monitorsToSetFor.every((i) => {
      const position = PanelSettings.getPanelPosition(this._settings, i)
      return position === Pos.LEFT || position === Pos.RIGHT
    })
    const allHorizontal = monitorsToSetFor.every((i) => {
      const position = PanelSettings.getPanelPosition(this._settings, i)
      return position === Pos.TOP || position === Pos.BOTTOM
    })

    const anchor_combo = this._builder.get_object('panel_anchor_combo')
    anchor_combo.remove_all()

    if (allHorizontal) {
      anchor_combo.append(Pos.START, _('Left'))
      anchor_combo.append(Pos.MIDDLE, _('Center'))
      anchor_combo.append(Pos.END, _('Right'))
    } else if (allVertical) {
      anchor_combo.append(Pos.START, _('Top'))
      anchor_combo.append(Pos.MIDDLE, _('Middle'))
      anchor_combo.append(Pos.END, _('Bottom'))
    } else {
      // Setting for a mix of horizontal and vertical panels on different monitors.
      anchor_combo.append(Pos.START, _('Start'))
      anchor_combo.append(Pos.MIDDLE, _('Middle'))
      anchor_combo.append(Pos.END, _('End'))
    }

    // Set combo box after re-populating its options. But only if it's for a single-panel
    // configuration, or a multi-panel configuration where they all have the same anchor
    // setting. So don't set the combo box if there is a multi-panel configuration with
    // different anchor settings.
    const someAnchor = PanelSettings.getPanelAnchor(
      this._settings,
      currentMonitorIndex,
    )
    if (
      monitorsToSetFor.every(
        (i) => PanelSettings.getPanelAnchor(this._settings, i) === someAnchor,
      )
    ) {
      const panel_anchor = PanelSettings.getPanelAnchor(
        this._settings,
        currentMonitorIndex,
      )
      this._builder.get_object('panel_anchor_combo').set_active_id(panel_anchor)
    }
  }

  /**
   * When a monitor is selected, update the widgets for panel position, size, anchoring,
   * and contents so they accurately show the settings for the panel on that monitor.
   */
  _updateWidgetSettingsForMonitor(monitorIndex) {
    // Update display of panel screen position setting
    const panelPosition = this._getPanelPosition(monitorIndex)
    this._setPositionRadios(panelPosition)

    // Update display of thickness, length, and anchor settings
    const panel_size_scale = this._builder.get_object('panel_size_scale')
    const size = PanelSettings.getPanelSize(this._settings, monitorIndex)
    panel_size_scale.set_value(size)

    const panel_length_scale = this._builder.get_object('panel_length_scale')
    const dynamicLengthButton = this._builder.get_object(
      'panel_length_dynamic_button',
    )
    const length = PanelSettings.getPanelLength(this._settings, monitorIndex)
    const isDynamicLength = length == -1

    dynamicLengthButton.set_active(isDynamicLength)
    panel_length_scale.set_value(isDynamicLength ? 100 : length)

    this._setAnchorLabels(monitorIndex)

    // Update display of panel content settings
    this._displayPanelPositionsForMonitor(monitorIndex)

    this._setPanelLenghtWidgetSensitivity(length)
  }

  /**
   * Anchor is only relevant if panel length is less than 100%. Enable or disable
   * anchor widget sensitivity accordingly.
   */
  _setPanelLenghtWidgetSensitivity(panelLength) {
    const taskbarListBox = this._builder.get_object('taskbar_display_listbox')
    let i = 0
    let row
    const isDynamicLength = panelLength == -1
    const isPartialLength = panelLength < 100

    this._builder
      .get_object('panel_length_scale')
      .set_sensitive(!isDynamicLength)
    this._builder
      .get_object('panel_anchor_label')
      .set_sensitive(isPartialLength)
    this._builder
      .get_object('panel_anchor_combo')
      .set_sensitive(isPartialLength)

    while ((row = taskbarListBox.get_row_at_index(i++)) != null) {
      let grid = row.get_child()
      let positionCombo = grid.get_child_at(4, 0)

      positionCombo.set_sensitive(!isDynamicLength)
    }
  }

  _displayPanelPositionsForMonitor(monitorIndex) {
    let taskbarListBox = this._builder.get_object('taskbar_display_listbox')

    while (taskbarListBox.get_first_child()) {
      taskbarListBox.remove(taskbarListBox.get_first_child())
    }

    let labels = {}
    let panelPosition = this._getPanelPosition(monitorIndex)
    let isVertical = panelPosition == Pos.LEFT || panelPosition == Pos.RIGHT
    let panelElementPositions = PanelSettings.getPanelElementPositions(
      this._settings,
      monitorIndex,
    )
    let updateElementsSettings = () => {
      let newPanelElementPositions = []
      let monitorSync = this._settings.get_boolean(
        'panel-element-positions-monitors-sync',
      )
      let monitors = monitorSync ? Object.keys(this.monitors) : [monitorIndex]

      let child = taskbarListBox.get_first_child()
      while (child != null) {
        newPanelElementPositions.push({
          element: child.id,
          visible: child.visibleToggleBtn.get_active(),
          position: child.positionCombo.get_active_id(),
        })
        child = child.get_next_sibling()
      }

      monitors.forEach((m) =>
        PanelSettings.setPanelElementPositions(
          this._settings,
          m,
          newPanelElementPositions,
        ),
      )
    }

    labels[Pos.SHOW_APPS_BTN] = _('Show Applications button')
    labels[Pos.ACTIVITIES_BTN] = _('Activities button')
    labels[Pos.TASKBAR] = _('Taskbar')
    labels[Pos.DATE_MENU] = _('Date menu')
    labels[Pos.SYSTEM_MENU] = _('System menu')
    labels[Pos.LEFT_BOX] = _('Left box')
    labels[Pos.CENTER_BOX] = _('Center box')
    labels[Pos.RIGHT_BOX] = _('Right box')
    labels[Pos.DESKTOP_BTN] = _('Desktop button')

    panelElementPositions.forEach((el) => {
      let row = new Gtk.ListBoxRow()
      let grid = new Gtk.Grid({
        margin_start: 12,
        margin_end: 12,
        column_spacing: 8,
      })
      let upDownGrid = new Gtk.Grid({ column_spacing: 2 })
      let upBtn = new Gtk.Button({ tooltip_text: _('Move up') })
      let upImg = new Gtk.Image({ icon_name: 'go-up-symbolic', pixel_size: 12 })
      let downBtn = new Gtk.Button({ tooltip_text: _('Move down') })
      let downImg = new Gtk.Image({
        icon_name: 'go-down-symbolic',
        pixel_size: 12,
      })
      let visibleToggleBtn = new Gtk.ToggleButton({
        label: _('Visible'),
        active: el.visible,
      })
      let positionCombo = new Gtk.ComboBoxText({
        tooltip_text: _('Select element position'),
      })
      let upDownClickHandler = (limit) => {
        let index = row.get_index()

        if (index != limit) {
          taskbarListBox.remove(row)
          taskbarListBox.insert(row, index + (!limit ? -1 : 1))
          updateElementsSettings()
        }
      }

      positionCombo.append(
        Pos.STACKED_TL,
        isVertical ? _('Stacked to top') : _('Stacked to left'),
      )
      positionCombo.append(
        Pos.STACKED_BR,
        isVertical ? _('Stacked to bottom') : _('Stacked to right'),
      )
      positionCombo.append(Pos.CENTERED, _('Centered'))
      positionCombo.append(Pos.CENTERED_MONITOR, _('Monitor Center'))
      positionCombo.set_active_id(el.position)

      upBtn.connect('clicked', () => upDownClickHandler(0))
      downBtn.connect('clicked', () =>
        upDownClickHandler(panelElementPositions.length - 1),
      )
      visibleToggleBtn.connect('toggled', () => updateElementsSettings())
      positionCombo.connect('changed', () => updateElementsSettings())

      upBtn.set_child(upImg)
      downBtn.set_child(downImg)

      upDownGrid.attach(upBtn, 0, 0, 1, 1)
      upDownGrid.attach(downBtn, 1, 0, 1, 1)

      grid.attach(upDownGrid, 0, 0, 1, 1)
      grid.attach(
        new Gtk.Label({ label: labels[el.element], xalign: 0, hexpand: true }),
        1,
        0,
        1,
        1,
      )

      if (Pos.optionDialogFunctions[el.element]) {
        let cogImg = new Gtk.Image({ icon_name: 'emblem-system-symbolic' })
        let optionsBtn = new Gtk.Button({ tooltip_text: _('More options') })

        optionsBtn.get_style_context().add_class('circular')
        optionsBtn.set_child(cogImg)
        grid.attach(optionsBtn, 2, 0, 1, 1)

        optionsBtn.connect('clicked', () =>
          this[Pos.optionDialogFunctions[el.element]](),
        )
      }

      grid.attach(visibleToggleBtn, 3, 0, 1, 1)
      grid.attach(positionCombo, 4, 0, 1, 1)

      row.id = el.element
      row.visibleToggleBtn = visibleToggleBtn
      row.positionCombo = positionCombo

      row.set_child(grid)
      taskbarListBox.insert(row, -1)
    })
  }

  _createPreferencesDialog(title, content, reset_function = null) {
    let dialog

    dialog = new Gtk.Dialog({
      title: title,
      transient_for: this.notebook.get_root(),
      use_header_bar: true,
      modal: true,
    })

    // GTK+ leaves positive values for application-defined response ids.
    // Use +1 for the reset action
    if (reset_function != null) dialog.add_button(_('Reset to defaults'), 1)

    dialog.get_content_area().append(content)

    dialog.connect('response', (dialog, id) => {
      if (id == 1) {
        // restore default settings
        if (reset_function) reset_function()
      } else {
        // remove the settings content so it doesn't get destroyed;
        dialog.get_content_area().remove(content)
        dialog.destroy()
      }
      return
    })

    return dialog
  }

  _showDateMenuOptions() {
    let box = this._builder.get_object('box_date_menu_options')

    let dialog = this._createPreferencesDialog(
      _('Date Menu options'),
      box,
      () => {
        // restore default settings
        this._gnomeInterfaceSettings.set_value('clock-show-date', this._gnomeInterfaceSettings.get_default_value('clock-show-date'))
        this._gnomeInterfaceSettings.set_value('clock-show-weekday', this._gnomeInterfaceSettings.get_default_value('clock-show-weekday'))
        this._gnomeInterfaceSettings.set_value('clock-show-seconds', this._gnomeInterfaceSettings.get_default_value('clock-show-seconds'))
      }
    )

    dialog.show()
    dialog.set_default_size(1, 1)
  }

  _showDesktopButtonOptions() {
    let box = this._builder.get_object('box_show_showdesktop_options')

    let dialog = this._createPreferencesDialog(
      _('Show Desktop options'),
      box,
      () => {
        // restore default settings
        this._settings.set_value(
          'show-showdesktop-icon',
          this._settings.get_default_value('show-showdesktop-icon'),
        )
        this._settings.set_value(
          'showdesktop-button-width',
          this._settings.get_default_value('showdesktop-button-width'),
        )
        this._builder
          .get_object('show_showdesktop_width_spinbutton')
          .set_value(this._settings.get_int('showdesktop-button-width'))

        this._settings.set_value(
          'show-showdesktop-hover',
          this._settings.get_default_value('show-showdesktop-hover'),
        )
      },
    )

    this._builder
      .get_object('show_showdesktop_width_spinbutton')
      .set_value(this._settings.get_int('showdesktop-button-width'))
    this._builder
      .get_object('show_showdesktop_width_spinbutton')
      .connect('value-changed', (widget) => {
        this._settings.set_int('showdesktop-button-width', widget.get_value())
      })

    dialog.show()
    dialog.set_default_size(1, 1)
  }

  _setMonitorsInfo() {
    this.monitors = PanelSettings.availableMonitors

    let panelOptionsMonitorCombo = this._builder.get_object(
      'taskbar_position_monitor_combo',
    )
    let dtpPrimaryMonitorIndex = 0

    this._currentMonitorIndex = dtpPrimaryMonitorIndex

    this._updateVerticalRelatedOptions()

    panelOptionsMonitorCombo.remove_all()

    for (let i = 0; i < this.monitors.length; ++i) {
      let monitor = this.monitors[i]
      let label = monitor.primary
        ? _('Primary monitor')
        : _('Monitor ') + (i + 1)

      label += monitor.product ? ` (${monitor.product})` : ''

      panelOptionsMonitorCombo.append_text(label)
    }

    panelOptionsMonitorCombo.set_active(dtpPrimaryMonitorIndex)
  }

  _bindSettings() {
    //multi-monitor
    this._setMonitorsInfo()

    this._settings.connect('changed::panel-positions', () =>
      this._updateVerticalRelatedOptions(),
    )

    this._settings.bind(
      'panel-element-positions-monitors-sync',
      this._builder.get_object('taskbar_position_sync_button'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'panel-element-positions-monitors-sync',
      this._builder.get_object('taskbar_position_monitor_combo'),
      'sensitive',
      Gio.SettingsBindFlags.INVERT_BOOLEAN,
    )

    this._settings.connect(
      'changed::panel-element-positions-monitors-sync',
      () => {
        // The anchor combo box may has different labels for single- or all-monitor configuration.
        this._setAnchorLabels(this._currentMonitorIndex)
      },
    )

    this._builder
      .get_object('taskbar_position_monitor_combo')
      .connect('changed', (widget) => {
        this._currentMonitorIndex = widget.get_active()
        this._updateWidgetSettingsForMonitor(this._currentMonitorIndex)
      })

    this._settings.bind(
      'multi-monitors',
      this._builder.get_object('multimon_multi_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    if (this.monitors.length === 1) {
      this._builder.get_object('multimon_multi_switch').set_sensitive(false)
    }

    let panelLengthScale = {
      objectName: 'panel_length_scale',
      valueName: '',
      range: LENGTH_MARKS,
      unit: '%',
      getValue: () =>
        PanelSettings.getPanelLength(this._settings, this._currentMonitorIndex),
      setValue: (value) => setPanelLength(value),
      manualConnect: true,
    }

    let setPanelLength = (value) => {
      const monitorSync = this._settings.get_boolean(
        'panel-element-positions-monitors-sync',
      )
      const monitorsToSetFor = monitorSync
        ? Object.keys(this.monitors)
        : [this._currentMonitorIndex]
      monitorsToSetFor.forEach((monitorIndex) => {
        PanelSettings.setPanelLength(this._settings, monitorIndex, value)
      })

      maybeSetPanelLengthScaleValueChange(value)
      this._setPanelLenghtWidgetSensitivity(value)
    }

    let maybeSetPanelLengthScaleValueChange = (value) => {
      const panel_length_scale = this._builder.get_object('panel_length_scale')

      if (panelLengthScale.valueChangedId) {
        panel_length_scale.disconnect(panelLengthScale.valueChangedId)
        panelLengthScale.valueChangedId = 0
      }

      if (value != -1) connectValueChanged(panel_length_scale, panelLengthScale)
      else panel_length_scale.set_value(100)
    }

    const dynamicLengthButton = this._builder.get_object(
      'panel_length_dynamic_button',
    )
    dynamicLengthButton.connect('notify::active', () => {
      setPanelLength(dynamicLengthButton.get_active() ? -1 : 100)
    })

    this._builder
      .get_object('panel_anchor_combo')
      .connect('changed', (widget) => {
        const value = widget.get_active_id()
        // Value can be null while anchor labels are being swapped out
        if (value !== null) {
          const monitorSync = this._settings.get_boolean(
            'panel-element-positions-monitors-sync',
          )
          const monitorsToSetFor = monitorSync
            ? Object.keys(this.monitors)
            : [this._currentMonitorIndex]
          monitorsToSetFor.forEach((monitorIndex) => {
            PanelSettings.setPanelAnchor(this._settings, monitorIndex, value)
          })
        }
      })

    this._updateWidgetSettingsForMonitor(this._currentMonitorIndex)

    //dynamic opacity
    this._settings.bind(
      'trans-use-custom-opacity',
      this._builder.get_object('trans_opacity_override_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'trans-use-custom-opacity',
      this._builder.get_object('trans_opacity_box'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'trans-use-custom-opacity',
      this._builder.get_object('trans_opacity_box2'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._builder
      .get_object('trans_opacity_override_switch')
      .connect('notify::active', (widget) => {
        if (!widget.get_active())
          this._builder.get_object('trans_dyn_switch').set_active(false)
      })

    this._builder
      .get_object('trans_opacity_spinbutton')
      .set_value(this._settings.get_double('trans-panel-opacity') * 100)
    this._builder
      .get_object('trans_opacity_spinbutton')
      .connect('value-changed', (widget) => {
        this._settings.set_double(
          'trans-panel-opacity',
          widget.get_value() * 0.01,
        )
      })

    this._settings.bind(
      'trans-use-dynamic-opacity',
      this._builder.get_object('trans_dyn_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'trans-use-dynamic-opacity',
      this._builder.get_object('trans_dyn_options_button'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'trans-dynamic-behavior',
      this._builder.get_object('trans_options_window_type_combo'),
      'active-id',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._builder
      .get_object('trans_options_min_opacity_spinbutton')
      .set_value(this._settings.get_double('trans-dynamic-anim-target') * 100)
    this._builder
      .get_object('trans_options_min_opacity_spinbutton')
      .connect('value-changed', (widget) => {
        this._settings.set_double(
          'trans-dynamic-anim-target',
          widget.get_value() * 0.01,
        )
      })

    this._builder
      .get_object('trans_dyn_options_button')
      .connect('clicked', () => {
        let box = this._builder.get_object('box_dynamic_opacity_options')

        let dialog = this._createPreferencesDialog(
          _('Dynamic opacity options'),
          box,
          () => {
            // restore default settings
            this._settings.set_value(
              'trans-dynamic-behavior',
              this._settings.get_default_value('trans-dynamic-behavior'),
            )

            this._settings.set_value(
              'trans-dynamic-anim-target',
              this._settings.get_default_value('trans-dynamic-anim-target'),
            )
            this._builder
              .get_object('trans_options_min_opacity_spinbutton')
              .set_value(
                this._settings.get_double('trans-dynamic-anim-target') * 100,
              )
          },
        )

        dialog.show()
        dialog.set_default_size(1, 1)
      })

    // Panel border
    /*this._settings.bind(
      'trans-use-border',
      this._builder.get_object('trans_border_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'trans-use-border',
      this._builder.get_object('trans_border_color_box'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'trans-use-border',
      this._builder.get_object('trans_border_width_box'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'trans-border-use-custom-color',
      this._builder.get_object('trans_border_color_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'trans-border-use-custom-color',
      this._builder.get_object('trans_border_color_colorbutton'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    let rgba = new Gdk.RGBA()
    rgba.parse(this._settings.get_string('trans-border-custom-color'))
    this._builder.get_object('trans_border_color_colorbutton').set_rgba(rgba)
    this._builder
      .get_object('trans_border_color_colorbutton')
      .connect('color-set', (button) => {
        let rgba = button.get_rgba()
        let css = rgba.to_string()
        this._settings.set_string('trans-border-custom-color', css)
      })

    this._builder
      .get_object('trans_border_width_spinbutton')
      .set_value(this._settings.get_int('trans-border-width'))
    this._builder
      .get_object('trans_border_width_spinbutton')
      .connect('value-changed', (widget) => {
        this._settings.set_int('trans-border-width', widget.get_value())
      })*/

    this._settings.bind(
      'intellihide',
      this._builder.get_object('intellihide_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide',
      this._builder.get_object('intellihide_options_button'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-hide-from-windows',
      this._builder.get_object('intellihide_window_hide_button'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-hide-from-monitor-windows',
      this._builder.get_object('intellihide_window_monitor_hide_button'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    let setIntellihideBehaviorSensitivity = () => {
      let overlappingButton = this._builder.get_object(
        'intellihide_window_hide_button',
      )
      let hideFromMonitorWindows = this._settings.get_boolean(
        'intellihide-hide-from-monitor-windows',
      )

      if (hideFromMonitorWindows) overlappingButton.set_active(false)

      overlappingButton.set_sensitive(!hideFromMonitorWindows)

      this._builder
        .get_object('intellihide_behaviour_options')
        .set_sensitive(
          this._settings.get_boolean('intellihide-hide-from-windows') ||
            hideFromMonitorWindows,
        )
    }

    this._settings.connect(
      'changed::intellihide-hide-from-windows',
      setIntellihideBehaviorSensitivity,
    )
    this._settings.connect(
      'changed::intellihide-hide-from-monitor-windows',
      setIntellihideBehaviorSensitivity,
    )

    setIntellihideBehaviorSensitivity()

    this._settings.bind(
      'intellihide-behaviour',
      this._builder.get_object('intellihide_behaviour_combo'),
      'active-id',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-use-pointer',
      this._builder.get_object('intellihide_use_pointer_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-use-pointer-limit-size',
      this._builder.get_object('intellihide_use_pointer_limit_button'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-use-pointer',
      this._builder.get_object('intellihide_use_pointer_limit_button'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-revealed-hover',
      this._builder.get_object('intellihide_revealed_hover_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-use-pointer',
      this._builder.get_object('intellihide_revealed_hover_switch'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-revealed-hover-limit-size',
      this._builder.get_object('intellihide_revealed_hover_limit_button'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-revealed-hover',
      this._builder.get_object('intellihide_revealed_hover_limit_button'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.connect('changed::intellihide-use-pointer', () => {
      if (!this._settings.get_boolean('intellihide-use-pointer')) {
        this._settings.set_boolean('intellihide-revealed-hover', false)
        this._settings.set_boolean('intellihide-use-pointer-limit-size', false)
        this._settings.set_boolean('intellihide-use-pressure', false)
      }
    })

    this._settings.connect('changed::intellihide-revealed-hover', () => {
      if (!this._settings.get_boolean('intellihide-revealed-hover')) {
        this._settings.set_boolean(
          'intellihide-revealed-hover-limit-size',
          false,
        )
      }
    })

    this._settings.bind(
      'intellihide-use-pointer',
      this._builder.get_object('intellihide_revealed_hover_options'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-use-pointer',
      this._builder.get_object('intellihide_use_pressure_options'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-use-pressure',
      this._builder.get_object('intellihide_use_pressure_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-show-in-fullscreen',
      this._builder.get_object('intellihide_show_in_fullscreen_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'intellihide-only-secondary',
      this._builder.get_object('intellihide_only_secondary_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'multi-monitors',
      this._builder.get_object('grid_intellihide_only_secondary'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._builder
      .get_object('multimon_multi_switch')
      .connect('notify::active', (widget) => {
        if (!widget.get_active())
          this._builder
            .get_object('intellihide_only_secondary_switch')
            .set_active(false)
      })

    this._settings.bind(
      'intellihide-key-toggle-text',
      this._builder.get_object('intellihide_toggle_entry'),
      'text',
      Gio.SettingsBindFlags.DEFAULT,
    )
    this._settings.connect('changed::intellihide-key-toggle-text', () =>
      setShortcut(this._settings, 'intellihide-key-toggle'),
    )

    let intellihidePersistStateSwitch = this._builder.get_object(
      'intellihide_persist_state_switch',
    )

    intellihidePersistStateSwitch.set_active(
      this._settings.get_int('intellihide-persisted-state') > -1,
    )

    intellihidePersistStateSwitch.connect('notify::active', (widget) => {
      this._settings.set_int(
        'intellihide-persisted-state',
        widget.get_active() ? 0 : -1,
      )
    })

    this._settings.bind(
      'intellihide-show-on-notification',
      this._builder.get_object('intellihide_show_on_notification_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._builder
      .get_object('intellihide_options_button')
      .connect('clicked', () => {
        let box = this._builder.get_object('box_intellihide_options')

        let dialog = this._createPreferencesDialog(
          _('Intellihide options'),
          box,
          () => {
            // restore default settings
            this._settings.set_value(
              'intellihide-hide-from-windows',
              this._settings.get_default_value('intellihide-hide-from-windows'),
            )
            this._settings.set_value(
              'intellihide-hide-from-monitor-windows',
              this._settings.get_default_value(
                'intellihide-hide-from-monitor-windows',
              ),
            )
            this._settings.set_value(
              'intellihide-behaviour',
              this._settings.get_default_value('intellihide-behaviour'),
            )
            this._settings.set_value(
              'intellihide-use-pointer',
              this._settings.get_default_value('intellihide-use-pointer'),
            )
            this._settings.set_value(
              'intellihide-use-pointer-limit-size',
              this._settings.get_default_value(
                'intellihide-use-pointer-limit-size',
              ),
            )
            this._settings.set_value(
              'intellihide-revealed-hover',
              this._settings.get_default_value('intellihide-revealed-hover'),
            )
            this._settings.set_value(
              'intellihide-revealed-hover-limit-size',
              this._settings.get_default_value(
                'intellihide-revealed-hover-limit-size',
              ),
            )
            this._settings.set_value(
              'intellihide-use-pressure',
              this._settings.get_default_value('intellihide-use-pressure'),
            )
            this._settings.set_value(
              'intellihide-show-in-fullscreen',
              this._settings.get_default_value(
                'intellihide-show-in-fullscreen',
              ),
            )
            this._settings.set_value(
              'intellihide-show-on-notification',
              this._settings.get_default_value(
                'intellihide-show-on-notification',
              ),
            )
            this._settings.set_value(
              'intellihide-persisted-state',
              this._settings.get_default_value('intellihide-persisted-state'),
            )
            this._settings.set_value(
              'intellihide-only-secondary',
              this._settings.get_default_value('intellihide-only-secondary'),
            )

            this._settings.set_value(
              'intellihide-key-toggle-text',
              this._settings.get_default_value('intellihide-key-toggle-text'),
            )

            intellihidePersistStateSwitch.set_active(false)
          },
        )

        dialog.show()
        dialog.set_default_size(1, 1)
      })

    // Behavior panel

    this._gnomeInterfaceSettings.bind(
      'clock-show-date',
      this._builder.get_object('date_menu_date_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._gnomeInterfaceSettings.bind(
      'clock-show-weekday',
      this._builder.get_object('date_menu_weekday_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._gnomeInterfaceSettings.bind(
      'clock-show-seconds',
      this._builder.get_object('date_menu_seconds_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'show-showdesktop-icon',
      this._builder.get_object('show_showdesktop_icon_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'show-showdesktop-hover',
      this._builder.get_object('show_showdesktop_hide_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'show-window-previews',
      this._builder.get_object('show_window_previews_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'show-window-previews',
      this._builder.get_object('show_window_previews_button'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'show-tooltip',
      this._builder.get_object('show_tooltip_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'show-favorites',
      this._builder.get_object('show_favorite_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'show-favorites-all-monitors',
      this._builder.get_object('multimon_multi_show_favorites_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'show-favorites',
      this._builder.get_object('multimon_multi_show_favorites_switch'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'show-running-apps',
      this._builder.get_object('show_runnning_apps_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._builder
      .get_object('show_window_previews_button')
      .connect('clicked', () => {
        let scrolledWindow = this._builder.get_object(
          'box_window_preview_options',
        )

        let dialog = this._createPreferencesDialog(
          _('Window preview options'),
          scrolledWindow,
          () => {
            // restore default settings
            this._settings.set_value(
              'peek-mode',
              this._settings.get_default_value('peek-mode'),
            )

            this._settings.set_value(
              'window-preview-size',
              this._settings.get_default_value('window-preview-size'),
            )
            this._builder
              .get_object('preview_size_spinbutton')
              .set_value(this._settings.get_int('window-preview-size'))

            this._settings.set_value(
              'preview-middle-click-close',
              this._settings.get_default_value('preview-middle-click-close'),
            )
          },
        )

        this._settings.bind(
          'preview-middle-click-close',
          this._builder.get_object('preview_middle_click_close_switch'),
          'active',
          Gio.SettingsBindFlags.DEFAULT,
        )

        this._settings.bind(
          'peek-mode',
          this._builder.get_object('peek_mode_switch'),
          'active',
          Gio.SettingsBindFlags.DEFAULT,
        )

        this._builder
          .get_object('preview_size_spinbutton')
          .set_value(this._settings.get_int('window-preview-size'))
        this._builder
          .get_object('preview_size_spinbutton')
          .connect('value-changed', (widget) => {
            this._settings.set_int('window-preview-size', widget.get_value())
          })

        dialog.show()
      })

    this._settings.bind(
      'group-apps',
      this._builder.get_object('group_apps_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.INVERT_BOOLEAN,
    )

    this._settings.bind(
      'group-apps',
      this._builder.get_object('show_group_apps_options_button'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.INVERT_BOOLEAN,
    )

    this._settings.bind(
      'progress-show-count',
      this._builder.get_object('show_notification_badge_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'group-apps-use-fixed-width',
      this._builder.get_object('group_apps_use_fixed_width_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'group-apps-use-launchers',
      this._builder.get_object('group_apps_use_launchers_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._builder
      .get_object('display_multitasking_settings')
      .connect('activated', () => {
        try {
          const output = GLib.spawn_command_line_async('gnome-control-center multitasking')
        } catch (e) {
          logError(e)
        }
      }
    )

    this._builder
      .get_object('show_group_apps_options_button')
      .connect('clicked', () => {
        let box = this._builder.get_object('box_group_apps_options')

        let dialog = this._createPreferencesDialog(
          _('Ungrouped application options'),
          box,
          () => {
            // restore default settings
            this._settings.set_value(
              'group-apps-label-max-width',
              this._settings.get_default_value('group-apps-label-max-width'),
            )
            this._builder
              .get_object('group_apps_label_max_width_spinbutton')
              .set_value(this._settings.get_int('group-apps-label-max-width'))

            this._settings.set_value(
              'group-apps-use-fixed-width',
              this._settings.get_default_value('group-apps-use-fixed-width'),
            )
            this._settings.set_value(
              'group-apps-use-launchers',
              this._settings.get_default_value('group-apps-use-launchers'),
            )
          },
        )

        this._builder
          .get_object('group_apps_label_max_width_spinbutton')
          .set_value(this._settings.get_int('group-apps-label-max-width'))
        this._builder
          .get_object('group_apps_label_max_width_spinbutton')
          .connect('value-changed', (widget) => {
            this._settings.set_int(
              'group-apps-label-max-width',
              widget.get_value(),
            )
          })

        dialog.show()
        dialog.set_default_size(600, 1)
      })

    this._builder
      .get_object('click_action_combo')
      .set_active_id(this._settings.get_string('click-action'))
    this._builder
      .get_object('click_action_combo')
      .connect('changed', (widget) => {
        this._settings.set_string('click-action', widget.get_active_id())
      })

    this._builder
      .get_object('shift_click_action_combo')
      .connect('changed', (widget) => {
        this._settings.set_string('shift-click-action', widget.get_active_id())
      })

    this._builder
      .get_object('middle_click_action_combo')
      .connect('changed', (widget) => {
        this._settings.set_string('middle-click-action', widget.get_active_id())
      })
    this._builder
      .get_object('shift_middle_click_action_combo')
      .connect('changed', (widget) => {
        this._settings.set_string(
          'shift-middle-click-action',
          widget.get_active_id(),
        )
      })

    // Create dialog for middle-click options
    this._builder
      .get_object('middle_click_options_button')
      .connect('clicked', () => {
        let box = this._builder.get_object('box_middle_click_options')

        let dialog = this._createPreferencesDialog(
          _('Customize middle-click behavior'),
          box,
          () => {
            // restore default settings for the relevant keys
            let keys = [
              'shift-click-action',
              'middle-click-action',
              'shift-middle-click-action',
            ]
            keys.forEach(function (val) {
              this._settings.set_value(
                val,
                this._settings.get_default_value(val),
              )
            }, this)
            this._builder
              .get_object('shift_click_action_combo')
              .set_active_id(this._settings.get_string('shift-click-action'))
            this._builder
              .get_object('middle_click_action_combo')
              .set_active_id(this._settings.get_string('middle-click-action'))
            this._builder
              .get_object('shift_middle_click_action_combo')
              .set_active_id(
                this._settings.get_string('shift-middle-click-action'),
              )
          },
        )

        this._builder
          .get_object('shift_click_action_combo')
          .set_active_id(this._settings.get_string('shift-click-action'))

        this._builder
          .get_object('middle_click_action_combo')
          .set_active_id(this._settings.get_string('middle-click-action'))

        this._builder
          .get_object('shift_middle_click_action_combo')
          .set_active_id(this._settings.get_string('shift-middle-click-action'))

        this._settings.bind(
          'shift-click-action',
          this._builder.get_object('shift_click_action_combo'),
          'active-id',
          Gio.SettingsBindFlags.DEFAULT,
        )
        this._settings.bind(
          'middle-click-action',
          this._builder.get_object('middle_click_action_combo'),
          'active-id',
          Gio.SettingsBindFlags.DEFAULT,
        )
        this._settings.bind(
          'shift-middle-click-action',
          this._builder.get_object('shift_middle_click_action_combo'),
          'active-id',
          Gio.SettingsBindFlags.DEFAULT,
        )

        dialog.show()
        dialog.set_default_size(700, 1)
      })

    this._builder
      .get_object('scroll_icon_combo')
      .set_active_id(this._settings.get_string('scroll-icon-action'))
    this._builder
      .get_object('scroll_icon_combo')
      .connect('changed', (widget) => {
        this._settings.set_string('scroll-icon-action', widget.get_active_id())
      })

    this._settings.bind(
      'hot-keys',
      this._builder.get_object('hot_keys_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )
    this._settings.bind(
      'hot-keys',
      this._builder.get_object('overlay_button'),
      'sensitive',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._builder.get_object('overlay_combo').connect('changed', (widget) => {
      this._settings.set_string('hotkeys-overlay-combo', widget.get_active_id())
    })

    this._settings.bind(
      'shortcut-previews',
      this._builder.get_object('shortcut_preview_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._builder
      .get_object('shortcut_num_keys_combo')
      .set_active_id(this._settings.get_string('shortcut-num-keys'))
    this._builder
      .get_object('shortcut_num_keys_combo')
      .connect('changed', (widget) => {
        this._settings.set_string('shortcut-num-keys', widget.get_active_id())
      })

    this._settings.connect('changed::hotkey-prefix-text', () => {
      checkHotkeyPrefix(this._settings)
    })

    this._builder
      .get_object('hotkey_prefix_combo')
      .set_active_id(this._settings.get_string('hotkey-prefix-text'))

    this._settings.bind(
      'hotkey-prefix-text',
      this._builder.get_object('hotkey_prefix_combo'),
      'active-id',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._builder
      .get_object('overlay_combo')
      .set_active_id(this._settings.get_string('hotkeys-overlay-combo'))

    this._settings.bind(
      'hotkeys-overlay-combo',
      this._builder.get_object('overlay_combo'),
      'active-id',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'shortcut-text',
      this._builder.get_object('shortcut_entry'),
      'text',
      Gio.SettingsBindFlags.DEFAULT,
    )
    this._settings.connect('changed::shortcut-text', () => {
      setShortcut(this._settings, 'shortcut')
    })

    // Create dialog for number overlay options
    this._builder.get_object('overlay_button').connect('clicked', () => {
      let box = this._builder.get_object('box_overlay_shortcut')

      let dialog = this._createPreferencesDialog(
        _('Advanced hotkeys options'),
        box,
        () => {
          // restore default settings for the relevant keys
          let keys = [
            'hotkey-prefix-text',
            'shortcut-text',
            'hotkeys-overlay-combo',
            'shortcut-previews',
          ]
          keys.forEach(function (val) {
            this._settings.set_value(val, this._settings.get_default_value(val))
          }, this)
        },
      )

      dialog.show()
      dialog.set_default_size(600, 1)
    })

    // Fine-tune panel

    let scaleInfos = [
      {
        objectName: 'panel_size_scale',
        valueName: 'tray-size',
        range: DEFAULT_PANEL_SIZES,
        getValue: () =>
          PanelSettings.getPanelSize(this._settings, this._currentMonitorIndex),
        setValue: (value) => {
          const monitorSync = this._settings.get_boolean(
            'panel-element-positions-monitors-sync',
          )
          const monitorsToSetFor = monitorSync
            ? Object.keys(this.monitors)
            : [this._currentMonitorIndex]
          monitorsToSetFor.forEach((monitorIndex) => {
            PanelSettings.setPanelSize(this._settings, monitorIndex, value)
          })
        },
      },
      panelLengthScale,
      {
        objectName: 'global_border_radius_scale',
        valueName: 'global-border-radius',
        range: [5, 4, 3, 2, 1, 0],
        rangeFactor: 5,
      },
      {
        objectName: 'panel_margin_scale',
        valueName: 'panel-margin',
        range: DEFAULT_MARGIN_SIZES,
      },
    ]

    let connectValueChanged = (scaleObj, scaleInfo) => {
      let timeoutId = 0

      scaleObj = scaleObj || this._builder.get_object(scaleInfo.objectName)

      scaleInfo.valueChangedId = scaleObj.connect('value-changed', () => {
        // Avoid settings the size consinuosly
        if (timeoutId > 0) GLib.Source.remove(timeoutId)

        timeoutId = GLib.timeout_add(
          GLib.PRIORITY_DEFAULT,
          SCALE_UPDATE_TIMEOUT,
          () => {
            let value = scaleObj.get_value()

            scaleInfo.setValue
              ? scaleInfo.setValue(value)
              : this._settings.set_int(scaleInfo.valueName, value)
            timeoutId = 0

            return GLib.SOURCE_REMOVE
          },
        )
      })
    }

    for (const idx in scaleInfos) {
      let scaleInfo = scaleInfos[idx]
      let scaleObj = this._builder.get_object(scaleInfo.objectName)
      let range = scaleInfo.range
      let factor = scaleInfo.rangeFactor
      let value = scaleInfo.getValue
        ? scaleInfo.getValue()
        : this._settings.get_int(scaleInfo.valueName)

      scaleObj.set_range(range[range.length - 1], range[0])
      scaleObj.set_value(value)
      // Add marks from range arrays, omitting the first and last values.
      range.slice(1, -1).forEach(function (val) {
        scaleObj.add_mark(
          val,
          Gtk.PositionType.TOP,
          (val * (factor || 1)).toString(),
        )
      })

      if (!scaleInfo.manualConnect) connectValueChanged(scaleObj, scaleInfo)

      scaleObj.set_format_value_func((scale, value) => {
        return `${value * (factor || 1)} ${scaleInfo.unit || 'px'}`
      })

      // Corrent for rtl languages
      if (this._rtl) {
        // Flip value position: this is not done automatically
        scaleObj.set_value_pos(Gtk.PositionType.LEFT)
        // I suppose due to a bug, having a more than one mark and one above a value of 100
        // makes the rendering of the marks wrong in rtl. This doesn't happen setting the scale as not flippable
        // and then manually inverting it
        scaleObj.set_flippable(false)
        scaleObj.set_inverted(true)
      }
    }

    maybeSetPanelLengthScaleValueChange(
      PanelSettings.getPanelLength(this._settings, this._currentMonitorIndex),
    )

    this._settings.bind(
      'stockgs-keep-dash',
      this._builder.get_object('stockgs_dash_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'stockgs-keep-top-panel',
      this._builder.get_object('stockgs_top_panel_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )

    this._settings.bind(
      'stockgs-panelbtn-click-only',
      this._builder.get_object('stockgs_panelbtn_switch'),
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    )
  }
}

const BuilderScope = GObject.registerClass(
  {
    Implements: [Gtk.BuilderScope],
  },
  class BuilderScope extends GObject.Object {
    _init(preferences) {
      this._preferences = preferences
      super._init()
    }

    vfunc_create_closure(builder, handlerName, flags, connectObject) {
      if (flags & Gtk.BuilderClosureFlags.SWAPPED)
        throw new Error('Unsupported template signal flag "swapped"')

      if (typeof this[handlerName] === 'undefined')
        throw new Error(`${handlerName} is undefined`)

      return this[handlerName].bind(connectObject || this)
    }

    on_btn_click(connectObject) {
      connectObject.set_label('Clicked')
    }

    position_bottom_button_clicked_cb(button) {
      if (!this._preferences._ignorePositionRadios && button.get_active())
        this._preferences._setPanelPosition(Pos.BOTTOM)
    }

    position_top_button_clicked_cb(button) {
      if (!this._preferences._ignorePositionRadios && button.get_active())
        this._preferences._setPanelPosition(Pos.TOP)
    }

    position_left_button_clicked_cb(button) {
      if (!this._preferences._ignorePositionRadios && button.get_active())
        this._preferences._setPanelPosition(Pos.LEFT)
    }

    position_right_button_clicked_cb(button) {
      if (!this._preferences._ignorePositionRadios && button.get_active())
        this._preferences._setPanelPosition(Pos.RIGHT)
    }
  },
)

export default class ZorinTaskbarPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    let closeRequestId = null

    window._settings = this.getSettings(
      'org.gnome.shell.extensions.zorin-taskbar',
    )
    window._gnomeInterfaceSettings = new Gio.Settings({
      schema_id: 'org.gnome.desktop.interface',
    })

    // use default width or window
    window.set_default_size(600, 625)

    new Preferences(window, window._settings, window._gnomeInterfaceSettings, this.path)
  }
}
