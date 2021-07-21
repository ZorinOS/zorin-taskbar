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

const GdkPixbuf = imports.gi.GdkPixbuf;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;
const N_ = function(e) { return e };
const Pos = Me.imports.panelPositions;

const SCALE_UPDATE_TIMEOUT = 500;
const DEFAULT_PANEL_SIZES = [ 128, 96, 64, 48, 32, 24 ];
const DEFAULT_MARGIN_SIZES = [ 32, 24, 16, 12, 8, 4, 0 ];
const DEFAULT_PADDING_SIZES = [ 32, 24, 16, 12, 8, 4, 0, -1 ];

const SCHEMA_PATH = '/org/gnome/shell/extensions/zorin-taskbar/';
const GSET = 'gnome-shell-extension-tool';

/**
 * This function was copied from the activities-config extension
 * https://github.com/nls1729/acme-code/tree/master/activities-config
 * by Norman L. Smith.
 */
function cssHexString(css) {
    let rrggbb = '#';
    let start;
    for (let loop = 0; loop < 3; loop++) {
        let end = 0;
        let xx = '';
        for (let loop = 0; loop < 2; loop++) {
            while (true) {
                let x = css.slice(end, end + 1);
                if ((x == '(') || (x == ',') || (x == ')'))
                    break;
                end++;
            }
            if (loop == 0) {
                end++;
                start = end;
            }
        }
        xx = parseInt(css.slice(start, end)).toString(16);
        if (xx.length == 1)
            xx = '0' + xx;
        rrggbb += xx;
        css = css.slice(end);
    }
    return rrggbb;
}

function setShortcut(settings, shortcutName) {
    let shortcut_text = settings.get_string(shortcutName + '-text');
    let [key, mods] = Gtk.accelerator_parse(shortcut_text);

    if (Gtk.accelerator_valid(key, mods)) {
        let shortcut = Gtk.accelerator_name(key, mods);
        settings.set_strv(shortcutName, [shortcut]);
    }
    else {
        settings.set_strv(shortcutName, []);
    }
}

function checkHotkeyPrefix(settings) {
    settings.delay();

    let hotkeyPrefix = settings.get_string('hotkey-prefix-text');
    if (hotkeyPrefix == 'Super')
       hotkeyPrefix = '<Super>';
    else if (hotkeyPrefix == 'SuperAlt')
       hotkeyPrefix = '<Super><Alt>';
    let [, mods]       = Gtk.accelerator_parse(hotkeyPrefix);
    let [, shift_mods] = Gtk.accelerator_parse('<Shift>' + hotkeyPrefix);
    let [, ctrl_mods]  = Gtk.accelerator_parse('<Ctrl>'  + hotkeyPrefix);

    let numHotkeys = 10;
    for (let i = 1; i <= numHotkeys; i++) {
        let number = i;
        if (number == 10)
            number = 0;
        let key    = Gdk.keyval_from_name(number.toString());
        let key_kp = Gdk.keyval_from_name('KP_' + number.toString());
        if (Gtk.accelerator_valid(key, mods)) {
            let shortcut    = Gtk.accelerator_name(key, mods);
            let shortcut_kp = Gtk.accelerator_name(key_kp, mods);

            // Setup shortcut strings
            settings.set_strv('app-hotkey-'    + i, [shortcut]);
            settings.set_strv('app-hotkey-kp-' + i, [shortcut_kp]);

            // With <Shift>
            shortcut    = Gtk.accelerator_name(key, shift_mods);
            shortcut_kp = Gtk.accelerator_name(key_kp, shift_mods);
            settings.set_strv('app-shift-hotkey-'    + i, [shortcut]);
            settings.set_strv('app-shift-hotkey-kp-' + i, [shortcut_kp]);

            // With <Control>
            shortcut    = Gtk.accelerator_name(key, ctrl_mods);
            shortcut_kp = Gtk.accelerator_name(key_kp, ctrl_mods);
            settings.set_strv('app-ctrl-hotkey-'    + i, [shortcut]);
            settings.set_strv('app-ctrl-hotkey-kp-' + i, [shortcut_kp]);
        }
        else {
            // Reset default settings for the relevant keys if the
            // accelerators are invalid
            let keys = ['app-hotkey-' + i, 'app-shift-hotkey-' + i, 'app-ctrl-hotkey-' + i,  // Regular numbers
                        'app-hotkey-kp-' + i, 'app-shift-hotkey-kp-' + i, 'app-ctrl-hotkey-kp-' + i]; // Key-pad numbers
            keys.forEach(function(val) {
                settings.set_value(val, settings.get_default_value(val));
            }, this);
        }
    }

    settings.apply();
}

function mergeObjects(main, bck) {
    for (var prop in bck) {
        if (!main.hasOwnProperty(prop) && bck.hasOwnProperty(prop)) {
            main[prop] = bck[prop];
        }
    }

    return main;
};

const Settings = new Lang.Class({
    Name: 'ZorinTaskbar.Settings',

    _init: function() {
        this._settings = Convenience.getSettings('org.gnome.shell.extensions.zorin-taskbar');
        this._gnomeInterfaceSettings = Convenience.getSettings('org.gnome.desktop.interface');

        this._rtl = (Gtk.Widget.get_default_direction() == Gtk.TextDirection.RTL);

        this._builder = new Gtk.Builder();
        this._builder.set_translation_domain(Me.metadata['gettext-domain']);
        this._builder.add_from_file(Me.path + '/Settings.ui');

        this.notebook = this._builder.get_object('settings_notebook');
        this.viewport = new Gtk.Viewport();
        this.viewport.add(this.notebook);
        this.widget = new Gtk.ScrolledWindow();
        this.widget.add(this.viewport);
        

        // Timeout to delay the update of the settings
        this._panel_size_timeout = 0;
        this._dot_height_timeout = 0;
        this._opacity_timeout = 0;

        this._bindSettings();

        this._builder.connect_signals_full(Lang.bind(this, this._connector));
    },

    /**
     * Connect signals
     */
    _connector: function(builder, object, signal, handler) {
        object.connect(signal, Lang.bind(this, this._SignalHandler[handler]));
    },

    _updateVerticalRelatedOptions: function() {
        let position = this._getPanelPosition(this._currentMonitorIndex);
        let isVertical = position == Pos.LEFT || position == Pos.RIGHT;
        let showDesktopWidthLabel = this._builder.get_object('show_showdesktop_width_label');

        showDesktopWidthLabel.set_text(_('Show Desktop button padding (px)'));

        this._displayPanelPositionsForMonitor(this._currentMonitorIndex);
    },

    _getPanelPositions: function() {
        return Pos.getSettingsPositions(this._settings, 'panel-positions');
    },

    _getPanelPosition: function(monitorIndex) {
        let panelPositionsSettings = this._getPanelPositions();
        
        return panelPositionsSettings[monitorIndex] || this._settings.get_string('panel-position');
    },

    _setPanelPosition: function(position) {
        let panelPositionsSettings = this._getPanelPositions();
        let monitorSync = this._settings.get_boolean('panel-element-positions-monitors-sync');
        let monitors = monitorSync ? this.monitors : [this._currentMonitorIndex];

        monitors.forEach(m => panelPositionsSettings[m] = position);

        this._settings.set_string('panel-positions', JSON.stringify(panelPositionsSettings));
    },

    _setPositionRadios: function(position) {
        this._ignorePositionRadios = true;
        
        switch (position) {
            case Pos.BOTTOM:
                this._builder.get_object('position_bottom_button').set_active(true);
                break;
            case Pos.TOP:
                this._builder.get_object('position_top_button').set_active(true);
                break;
            case Pos.LEFT:
                this._builder.get_object('position_left_button').set_active(true);
                break;
            case Pos.RIGHT:
                this._builder.get_object('position_right_button').set_active(true);
                break;
        }

        this._ignorePositionRadios = false;
    },

    _displayPanelPositionsForMonitor: function(monitorIndex) {
        let taskbarListBox = this._builder.get_object('taskbar_display_listbox');
        
        taskbarListBox.get_children().forEach(c => c.destroy());

        let labels = {};
        let panelPosition = this._getPanelPosition(monitorIndex);
        let isVertical = panelPosition == Pos.LEFT || panelPosition == Pos.RIGHT;
        let panelElementPositionsSettings = Pos.getSettingsPositions(this._settings, 'panel-element-positions');
        let panelElementPositions = panelElementPositionsSettings[monitorIndex] || Pos.defaults;
        let updateElementsSettings = () => {
            let newPanelElementPositions = [];
            let monitorSync = this._settings.get_boolean('panel-element-positions-monitors-sync');
            let monitors = monitorSync ? this.monitors : [monitorIndex];

            taskbarListBox.get_children().forEach(c => {
                newPanelElementPositions.push({
                    element: c.id,
                    visible: c.visibleToggleBtn.get_active(),
                    position: c.positionCombo.get_active_id()
                });
            });
            
            monitors.forEach(m => panelElementPositionsSettings[m] = newPanelElementPositions);
            this._settings.set_string('panel-element-positions', JSON.stringify(panelElementPositionsSettings));
        };

        this._setPositionRadios(panelPosition);
        
        labels[Pos.SHOW_APPS_BTN] = _('Show Applications button');
        labels[Pos.ACTIVITIES_BTN] = _('Activities button');
        labels[Pos.TASKBAR] = _('Taskbar');
        labels[Pos.DATE_MENU] = _('Date menu');
        labels[Pos.SYSTEM_MENU] = _('System menu');
        labels[Pos.LEFT_BOX] = _('Left box');
        labels[Pos.CENTER_BOX] = _('Center box');
        labels[Pos.RIGHT_BOX] = _('Right box');
        labels[Pos.DESKTOP_BTN] = _('Desktop button');

        panelElementPositions.forEach(el => {
            let row = new Gtk.ListBoxRow();
            let grid = new Gtk.Grid({ margin: 2, margin_left: 12, margin_right: 12, column_spacing: 8 });
            let upDownGrid = new Gtk.Grid({ column_spacing: 2 });
            let upBtn = new Gtk.Button({ tooltip_text: _('Move up') });
            let upImg = new Gtk.Image({ icon_name: 'go-up-symbolic', pixel_size: 12 });
            let downBtn = new Gtk.Button({ tooltip_text: _('Move down') });
            let downImg = new Gtk.Image({ icon_name: 'go-down-symbolic', pixel_size: 12 });
            let visibleToggleBtn = new Gtk.ToggleButton({ label: _('Visible'), active: el.visible });
            let positionCombo = new Gtk.ComboBoxText({ tooltip_text: _('Select element position') });
            let upDownClickHandler = limit => {
                let index = row.get_index();

                if (index != limit) {
                    taskbarListBox.remove(row);
                    taskbarListBox.insert(row, index + (!limit ? -1 : 1));
                    updateElementsSettings();
                }
            };

            positionCombo.append(Pos.STACKED_TL, isVertical ? _('Stacked to top') : _('Stacked to left'));
            positionCombo.append(Pos.STACKED_BR, isVertical ? _('Stacked to bottom') :_('Stacked to right'));
            positionCombo.append(Pos.CENTERED, _('Centered'));
            positionCombo.append(Pos.CENTERED_MONITOR, _('Monitor Center'));
            positionCombo.set_active_id(el.position);

            upBtn.connect('clicked', () => upDownClickHandler(0));
            downBtn.connect('clicked', () => upDownClickHandler(panelElementPositions.length - 1));
            visibleToggleBtn.connect('toggled', () => updateElementsSettings());
            positionCombo.connect('changed', () => updateElementsSettings());

            upBtn.add(upImg);
            downBtn.add(downImg);

            upDownGrid.add(upBtn);
            upDownGrid.add(downBtn);

            grid.add(upDownGrid);
            grid.add(new Gtk.Label({ label: labels[el.element], xalign: 0, hexpand: true }));

            if (Pos.optionDialogFunctions[el.element]) {
                let cogImg = new Gtk.Image({ icon_name: 'emblem-system-symbolic' });
                let optionsBtn = new Gtk.Button({ tooltip_text: _('More options') });
                
                optionsBtn.get_style_context().add_class('circular');
                optionsBtn.add(cogImg);
                grid.add(optionsBtn);

                optionsBtn.connect('clicked', () => this[Pos.optionDialogFunctions[el.element]]());
            }

            grid.add(visibleToggleBtn);
            grid.add(positionCombo);

            row.id = el.element;
            row.visibleToggleBtn = visibleToggleBtn;
            row.positionCombo = positionCombo;

            row.add(grid);
            taskbarListBox.add(row);
        });

        taskbarListBox.show_all();
    },

    _showShowAppsButtonOptions: function() {
        let dialog = new Gtk.Dialog({ title: _('Show Applications options'),
                                        transient_for: this.widget.get_toplevel(),
                                        use_header_bar: true,
                                        modal: true });

        // GTK+ leaves positive values for application-defined response ids.
        // Use +1 for the reset action
        dialog.add_button(_('Reset to defaults'), 1);

        let box = this._builder.get_object('show_applications_options');
        dialog.get_content_area().add(box);

        dialog.connect('response', Lang.bind(this, function(dialog, id) {
            if (id == 1) {
                // restore default settings
                this._settings.set_value('show-apps-override-escape', this._settings.get_default_value('show-apps-override-escape'));
                this._settings.set_value('animate-show-apps', this._settings.get_default_value('animate-show-apps'));
            } else {
                // remove the settings box so it doesn't get destroyed;
                dialog.get_content_area().remove(box);
                dialog.destroy();
            }
            return;
        }));

        dialog.show_all();
    },
    
    _showDateMenuOptions: function() {
        let dialog = new Gtk.Dialog({ title: _('Date Menu options'),
                                        transient_for: this.widget.get_toplevel(),
                                        use_header_bar: true,
                                        modal: true });

        // GTK+ leaves positive values for application-defined response ids.
        // Use +1 for the reset action
        dialog.add_button(_('Reset to defaults'), 1);

        let box = this._builder.get_object('date_menu_options');
        dialog.get_content_area().add(box);

        dialog.connect('response', Lang.bind(this, function(dialog, id) {
            if (id == 1) {
                // restore default settings
                this._gnomeInterfaceSettings.set_value('clock-show-date', this._gnomeInterfaceSettings.get_default_value('clock-show-date'));
                this._gnomeInterfaceSettings.set_value('clock-show-seconds', this._gnomeInterfaceSettings.get_default_value('clock-show-seconds'));
                this._gnomeInterfaceSettings.set_value('clock-show-weekday', this._gnomeInterfaceSettings.get_default_value('clock-show-weekday'));
            } else {
                // remove the settings box so it doesn't get destroyed;
                dialog.get_content_area().remove(box);
                dialog.destroy();
            }
            return;
        }));

        dialog.show_all();
    },

    _showDesktopButtonOptions: function() {
        let dialog = new Gtk.Dialog({ title: _('Show Desktop options'),
                                        transient_for: this.widget.get_toplevel(),
                                        use_header_bar: true,
                                        modal: true });

        // GTK+ leaves positive values for application-defined response ids.
        // Use +1 for the reset action
        dialog.add_button(_('Reset to defaults'), 1);

        let box = this._builder.get_object('box_show_showdesktop_options');
        dialog.get_content_area().add(box);

        this._builder.get_object('show_showdesktop_width_spinbutton').set_value(this._settings.get_int('showdesktop-button-width'));
        this._builder.get_object('show_showdesktop_width_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
            this._settings.set_int('showdesktop-button-width', widget.get_value());
        }));

        dialog.connect('response', Lang.bind(this, function(dialog, id) {
            if (id == 1) {
                // restore default settings
                this._settings.set_value('show-showdesktop-icon', this._settings.get_default_value('show-showdesktop-icon'));
                
                this._settings.set_value('showdesktop-button-width', this._settings.get_default_value('showdesktop-button-width'));
                this._builder.get_object('show_showdesktop_width_spinbutton').set_value(this._settings.get_int('showdesktop-button-width'));

                this._settings.set_value('show-showdesktop-hover', this._settings.get_default_value('show-showdesktop-hover'));
            } else {
                // remove the settings box so it doesn't get destroyed;
                dialog.get_content_area().remove(box);
                dialog.destroy();
            }
            return;
        }));

        dialog.show_all();
    },

    _bindSettings: function() {
        // size options
        let panel_size_scale = this._builder.get_object('panel_size_scale');
        panel_size_scale.set_range(DEFAULT_PANEL_SIZES[DEFAULT_PANEL_SIZES.length-1], DEFAULT_PANEL_SIZES[0]);
        panel_size_scale.set_value(this._settings.get_int('panel-size'));
        DEFAULT_PANEL_SIZES.slice(1, -1).forEach(function(val) {
             panel_size_scale.add_mark(val, Gtk.PositionType.TOP, val.toString());
        });

        // Corrent for rtl languages
        if (this._rtl) {
            // Flip value position: this is not done automatically
            panel_size_scale.set_value_pos(Gtk.PositionType.LEFT);
            // I suppose due to a bug, having a more than one mark and one above a value of 100
            // makes the rendering of the marks wrong in rtl. This doesn't happen setting the scale as not flippable
            // and then manually inverting it
            panel_size_scale.set_flippable(false);
            panel_size_scale.set_inverted(true);
        }

        //multi-monitor
        this.monitors = this._settings.get_value('available-monitors').deep_unpack();

        let dtpPrimaryMonitorIndex = 0;

        this._currentMonitorIndex = this.monitors[dtpPrimaryMonitorIndex];

        this._settings.connect('changed::panel-positions', () => this._updateVerticalRelatedOptions());
        this._updateVerticalRelatedOptions();
        
        for (let i = 0; i < this.monitors.length; ++i) {
            //the primary index is the first one in the "available-monitors" setting
            let label = !i ? _('Primary monitor') : _('Monitor ') + (i + 1);

            this._builder.get_object('taskbar_position_monitor_combo').append_text(label);
        }
        
        this._builder.get_object('taskbar_position_monitor_combo').set_active(dtpPrimaryMonitorIndex);

        this._settings.bind('panel-element-positions-monitors-sync',
                            this._builder.get_object('taskbar_position_sync_button'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('panel-element-positions-monitors-sync',
                            this._builder.get_object('taskbar_position_monitor_combo'),
                            'sensitive',
                            Gio.SettingsBindFlags.INVERT_BOOLEAN);

        this._builder.get_object('taskbar_position_monitor_combo').connect('changed', Lang.bind (this, function(widget) {
            this._currentMonitorIndex = this.monitors[widget.get_active()];
            this._displayPanelPositionsForMonitor(this._currentMonitorIndex);
        }));

        //panel positions
        this._displayPanelPositionsForMonitor(this._currentMonitorIndex);

        this._settings.bind('multi-monitors',
                            this._builder.get_object('multimon_multi_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        if (this.monitors.length === 1) {
            this._builder.get_object('multimon_multi_switch').set_sensitive(false);
        }
        
        //dynamic opacity
        let rgba = new Gdk.RGBA();
        
        this._settings.bind('trans-use-custom-opacity',
                            this._builder.get_object('trans_opacity_override_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('trans-use-custom-opacity',
                            this._builder.get_object('trans_opacity_box'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._builder.get_object('trans_opacity_spinbutton').set_value(this._settings.get_double('trans-panel-opacity') * 100);
        this._builder.get_object('trans_opacity_spinbutton').connect('value-changed', Lang.bind(this, function (widget) {
            this._settings.set_double('trans-panel-opacity', widget.get_value() * 0.01);
        }));
       
        this._settings.bind('intellihide',
                            this._builder.get_object('intellihide_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('intellihide',
                            this._builder.get_object('intellihide_options_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
                            
        this._settings.bind('intellihide-floating-rounded-theme',
                            this._builder.get_object('intellihide_floating_rounded_theme_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT); 

        this._settings.bind('intellihide-hide-from-windows',
                            this._builder.get_object('intellihide_window_hide_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('intellihide-hide-from-windows',
                            this._builder.get_object('intellihide_behaviour_options'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('intellihide-behaviour',
                            this._builder.get_object('intellihide_behaviour_combo'),
                            'active-id',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('intellihide-use-pressure',
                            this._builder.get_object('intellihide_use_pressure_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT); 

        this._settings.bind('intellihide-show-in-fullscreen',
                            this._builder.get_object('intellihide_show_in_fullscreen_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('intellihide-only-secondary',
                            this._builder.get_object('intellihide_only_secondary_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('multi-monitors',
                            this._builder.get_object('grid_intellihide_only_secondary'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._builder.get_object('multimon_multi_switch').connect('notify::active', (widget) => {
            if (!widget.get_active())
                this._builder.get_object('intellihide_only_secondary_switch').set_active(false);
        });

        this._settings.bind('intellihide-key-toggle-text',
                             this._builder.get_object('intellihide_toggle_entry'),
                             'text',
                             Gio.SettingsBindFlags.DEFAULT);
        this._settings.connect('changed::intellihide-key-toggle-text', () => setShortcut(this._settings, 'intellihide-key-toggle'));

        this._builder.get_object('intellihide_options_button').connect('clicked', Lang.bind(this, function() {
            let dialog = new Gtk.Dialog({ title: _('Intellihide options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_intellihide_options');
            dialog.get_content_area().add(box);

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('intellihide-floating-rounded-theme', this._settings.get_default_value('intellihide-floating-rounded-theme'));
                    this._settings.set_value('intellihide-hide-from-windows', this._settings.get_default_value('intellihide-hide-from-windows'));
                    this._settings.set_value('intellihide-behaviour', this._settings.get_default_value('intellihide-behaviour'));
                    this._settings.set_value('intellihide-use-pressure', this._settings.get_default_value('intellihide-use-pressure'));
                    this._settings.set_value('intellihide-show-in-fullscreen', this._settings.get_default_value('intellihide-show-in-fullscreen'));
                    this._settings.set_value('intellihide-only-secondary', this._settings.get_default_value('intellihide-only-secondary'));

                    this._settings.set_value('intellihide-key-toggle-text', this._settings.get_default_value('intellihide-key-toggle-text'));
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));

        // Behavior panel

        this._settings.bind('animate-show-apps',
                            this._builder.get_object('application_button_animation_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-apps-override-escape',
                            this._builder.get_object('show_applications_esc_key_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
                            
        this._gnomeInterfaceSettings.bind('clock-show-date',
                                          this._builder.get_object('date_menu_date_switch'),
                                          'active',
                                          Gio.SettingsBindFlags.DEFAULT);
                            
        this._gnomeInterfaceSettings.bind('clock-show-seconds',
                                          this._builder.get_object('date_menu_seconds_switch'),
                                          'active',
                                          Gio.SettingsBindFlags.DEFAULT);
                            
        this._gnomeInterfaceSettings.bind('clock-show-weekday',
                                          this._builder.get_object('date_menu_weekday_switch'),
                                          'active',
                                          Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-showdesktop-hover',
                            this._builder.get_object('show_showdesktop_hide_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
                            
        this._settings.bind('show-showdesktop-icon',
                            this._builder.get_object('show_showdesktop_icon_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-window-previews',
                            this._builder.get_object('show_window_previews_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-window-previews',
                            this._builder.get_object('show_window_previews_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-tooltip',
                            this._builder.get_object('show_tooltip_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-favorites',
                            this._builder.get_object('show_favorite_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-favorites-all-monitors',
                            this._builder.get_object('multimon_multi_show_favorites_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
                            
        this._settings.bind('show-favorites',
                            this._builder.get_object('multimon_multi_show_favorites_switch'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-running-apps',
                            this._builder.get_object('show_runnning_apps_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT); 

        this._builder.get_object('show_window_previews_button').connect('clicked', Lang.bind(this, function() {

            let dialog = new Gtk.Dialog({ title: _('Window preview options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let scrolledWindow = this._builder.get_object('box_window_preview_options');

            adjustScrollableHeight(this._builder.get_object('viewport_window_preview_options'), scrolledWindow);
            
            dialog.get_content_area().add(scrolledWindow);

            this._settings.bind('preview-middle-click-close',
                            this._builder.get_object('preview_middle_click_close_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('peek-mode',
                            this._builder.get_object('peek_mode_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
            
            this._builder.get_object('preview_size_spinbutton').set_value(this._settings.get_int('window-preview-size'));
            this._builder.get_object('preview_size_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('window-preview-size', widget.get_value());
            }));

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings                   
                    this._settings.set_value('peek-mode', this._settings.get_default_value('peek-mode'));

                    this._settings.set_value('window-preview-size', this._settings.get_default_value('window-preview-size'));
                    this._builder.get_object('preview_size_spinbutton').set_value(this._settings.get_int('window-preview-size'));

                    this._settings.set_value('preview-middle-click-close', this._settings.get_default_value('preview-middle-click-close'));

                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(scrolledWindow);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));
       
        this._settings.bind('isolate-workspaces',
                            this._builder.get_object('isolate_workspaces_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('isolate-monitors',
                            this._builder.get_object('multimon_multi_isolate_monitor_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('group-apps',
                            this._builder.get_object('group_apps_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        this._settings.bind('group-apps',
                            this._builder.get_object('show_group_apps_options_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        this._settings.bind('group-apps-use-fixed-width',
                            this._builder.get_object('group_apps_use_fixed_width_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('group-apps-use-launchers',
                            this._builder.get_object('group_apps_use_launchers_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);    

        this._builder.get_object('show_group_apps_options_button').connect('clicked', Lang.bind(this, function() {
            let dialog = new Gtk.Dialog({ title: _('Ungrouped application options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_group_apps_options');
            dialog.get_content_area().add(box);

            this._builder.get_object('group_apps_label_max_width_spinbutton').set_value(this._settings.get_int('group-apps-label-max-width'));
            this._builder.get_object('group_apps_label_max_width_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('group-apps-label-max-width', widget.get_value());
            }));

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('group-apps-label-max-width', this._settings.get_default_value('group-apps-label-max-width'));
                    this._builder.get_object('group_apps_label_max_width_spinbutton').set_value(this._settings.get_int('group-apps-label-max-width'));

                    this._settings.set_value('group-apps-use-fixed-width', this._settings.get_default_value('group-apps-use-fixed-width'));
                    this._settings.set_value('group-apps-use-launchers', this._settings.get_default_value('group-apps-use-launchers'));
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));    

        this._builder.get_object('click_action_combo').set_active_id(this._settings.get_string('click-action'));
        this._builder.get_object('click_action_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('click-action', widget.get_active_id());
        }));

        this._builder.get_object('shift_click_action_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('shift-click-action', widget.get_active_id());
        }));

        this._builder.get_object('middle_click_action_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('middle-click-action', widget.get_active_id());
        }));
        this._builder.get_object('shift_middle_click_action_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('shift-middle-click-action', widget.get_active_id());
        }));

        // Create dialog for middle-click options
        this._builder.get_object('middle_click_options_button').connect('clicked', Lang.bind(this, function() {

            let dialog = new Gtk.Dialog({ title: _('Customize middle-click behavior'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_middle_click_options');
            dialog.get_content_area().add(box);

            this._builder.get_object('shift_click_action_combo').set_active_id(this._settings.get_string('shift-click-action'));

            this._builder.get_object('middle_click_action_combo').set_active_id(this._settings.get_string('middle-click-action'));

            this._builder.get_object('shift_middle_click_action_combo').set_active_id(this._settings.get_string('shift-middle-click-action'));

            this._settings.bind('shift-click-action',
                                this._builder.get_object('shift_click_action_combo'),
                                'active-id',
                                Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('middle-click-action',
                                this._builder.get_object('middle_click_action_combo'),
                                'active-id',
                                Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('shift-middle-click-action',
                                this._builder.get_object('shift_middle_click_action_combo'),
                                'active-id',
                                Gio.SettingsBindFlags.DEFAULT);

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings for the relevant keys
                    let keys = ['shift-click-action', 'middle-click-action', 'shift-middle-click-action'];
                    keys.forEach(function(val) {
                        this._settings.set_value(val, this._settings.get_default_value(val));
                    }, this);
                    this._builder.get_object('shift_click_action_combo').set_active_id(this._settings.get_string('shift-click-action'));
                    this._builder.get_object('middle_click_action_combo').set_active_id(this._settings.get_string('middle-click-action'));
                    this._builder.get_object('shift_middle_click_action_combo').set_active_id(this._settings.get_string('shift-middle-click-action'));
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));

        this._builder.get_object('scroll_icon_combo').set_active_id(this._settings.get_string('scroll-icon-action'));
        this._builder.get_object('scroll_icon_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('scroll-icon-action', widget.get_active_id());
        }));

        this._settings.bind('hot-keys',
                            this._builder.get_object('hot_keys_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('hot-keys',
                            this._builder.get_object('overlay_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._builder.get_object('overlay_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('hotkeys-overlay-combo', widget.get_active_id());
        }));

        this._settings.bind('shortcut-previews',
                            this._builder.get_object('shortcut_preview_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._builder.get_object('shortcut_num_keys_combo').set_active_id(this._settings.get_string('shortcut-num-keys'));
        this._builder.get_object('shortcut_num_keys_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('shortcut-num-keys', widget.get_active_id());
        }));

        this._settings.connect('changed::hotkey-prefix-text', Lang.bind(this, function() {checkHotkeyPrefix(this._settings);}));

        this._builder.get_object('hotkey_prefix_combo').set_active_id(this._settings.get_string('hotkey-prefix-text'));

        this._settings.bind('hotkey-prefix-text',
                            this._builder.get_object('hotkey_prefix_combo'),
                            'active-id',
                            Gio.SettingsBindFlags.DEFAULT);

        this._builder.get_object('overlay_combo').set_active_id(this._settings.get_string('hotkeys-overlay-combo'));

        this._settings.bind('hotkeys-overlay-combo',
                            this._builder.get_object('overlay_combo'),
                            'active-id',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('shortcut-text',
                            this._builder.get_object('shortcut_entry'),
                            'text',
                            Gio.SettingsBindFlags.DEFAULT);
        this._settings.connect('changed::shortcut-text', Lang.bind(this, function() {setShortcut(this._settings, 'shortcut');}));

        // Create dialog for number overlay options
        this._builder.get_object('overlay_button').connect('clicked', Lang.bind(this, function() {

            let dialog = new Gtk.Dialog({ title: _('Advanced hotkeys options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_overlay_shortcut');
            dialog.get_content_area().add(box);

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings for the relevant keys
                    let keys = ['hotkey-prefix-text', 'shortcut-text', 'hotkeys-overlay-combo', 'shortcut-previews'];
                    keys.forEach(function(val) {
                        this._settings.set_value(val, this._settings.get_default_value(val));
                    }, this);
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));
    },

    /**
     * Object containing all signals defined in the glade file
     */
    _SignalHandler: {
        
        position_bottom_button_clicked_cb: function(button) {
            if (!this._ignorePositionRadios && button.get_active()) this._setPanelPosition(Pos.BOTTOM);
        },
		
		position_top_button_clicked_cb: function(button) {
            if (!this._ignorePositionRadios && button.get_active()) this._setPanelPosition(Pos.TOP);
        },
        
        position_left_button_clicked_cb: function(button) {
            if (!this._ignorePositionRadios && button.get_active()) this._setPanelPosition(Pos.LEFT);
        },
		
		position_right_button_clicked_cb: function(button) {
            if (!this._ignorePositionRadios && button.get_active()) this._setPanelPosition(Pos.RIGHT);
        },

        panel_size_scale_format_value_cb: function(scale, value) {
            return value+ ' px';
        },

        panel_size_scale_value_changed_cb: function(scale) {
            // Avoid settings the size consinuosly
            if (this._panel_size_timeout > 0)
                Mainloop.source_remove(this._panel_size_timeout);

            this._panel_size_timeout = Mainloop.timeout_add(SCALE_UPDATE_TIMEOUT, Lang.bind(this, function() {
                this._settings.set_int('panel-size', scale.get_value());
                this._panel_size_timeout = 0;
                return GLib.SOURCE_REMOVE;
            }));
        }
    }
});

function init() {
    Convenience.initTranslations();
}

function buildPrefsWidget() {
    let settings = new Settings();
    let widget = settings.widget;

    // I'd like the scrolled window to default to a size large enough to show all without scrolling, if it fits on the screen
    // But, it doesn't seem possible, so I'm setting a minimum size if there seems to be enough screen real estate
    widget.show_all();
    adjustScrollableHeight(settings.viewport, widget);
    
    return widget;
}

function adjustScrollableHeight(viewport, scrollableWindow) {
    let viewportSize = viewport.size_request();
    let screenHeight = scrollableWindow.get_screen().get_height() - 120;
    
    scrollableWindow.set_size_request(viewportSize.width, viewportSize.height > screenHeight ? screenHeight : viewportSize.height);  
}
