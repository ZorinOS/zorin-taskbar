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
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 *
 * Credits:
 * This file is based on code from the Dash to Panel extension
 */

const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Lang = imports.lang;
const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const St = imports.gi.St;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Panel = Me.imports.panel;
const Proximity = Me.imports.proximity;
const Utils = Me.imports.utils;

var DynamicTransparency = Utils.defineClass({
    Name: 'ZorinTaskbar.DynamicTransparency',

    _init: function(dtpPanel) {
        this._dtpPanel = dtpPanel;
        this.currentBackgroundColor = 0;

        this._initialPanelStyle = dtpPanel.panel.actor.get_style();
        
        if (this._dtpPanel.geom.position == St.Side.TOP) {
            this._initialPanelCornerStyle = dtpPanel.panel._leftCorner.actor.get_style();
        }

        this._signalsHandler = new Utils.GlobalSignalsHandler();
        this._bindSignals();

        this._updateAllAndSet();
    },

    destroy: function() {
        this._signalsHandler.destroy();

        this._dtpPanel.panel.actor.set_style(this._initialPanelStyle);
        
        if (this._dtpPanel.geom.position == St.Side.TOP) {
            this._dtpPanel.panel._leftCorner.actor.set_style(this._initialPanelCornerStyle);
            this._dtpPanel.panel._rightCorner.actor.set_style(this._initialPanelCornerStyle);
        }
    },

    updateExternalStyle: function() {
        this._updateComplementaryStyles();
        this._setBackground();
    },

    _bindSignals: function() {
        this._signalsHandler.add(
            [
                Utils.getStageTheme(),
                'changed',
                () => this._updateAllAndSet()
            ],
            [
                Main.overview,
                [
                    'showing',
                    'hiding'
                ],
                () => this._updateAlphaAndSet()
            ],
            [
                Me.settings,
                [
                    'changed::trans-use-custom-opacity',
                    'changed::trans-panel-opacity'
                ],
                () => this._updateAlphaAndSet()
            ]
        );
    },

    _updateAllAndSet: function() {
        let themeBackground = this._getThemeBackground(true);

        this._updateColor(themeBackground);
        this._updateAlpha(themeBackground);
        this._updateComplementaryStyles();
        this._setBackground();
        this._setActorStyle();
    },

    _updateAlphaAndSet: function() {
        this._updateAlpha();
        this._setBackground();
    },

    _updateComplementaryStyles: function() {
        let panelThemeNode = this._dtpPanel.panel.actor.get_theme_node();

        this._complementaryStyles = 'border-radius: ' + panelThemeNode.get_border_radius(0) + 'px;';
    },

    _updateColor: function(themeBackground) {
        this.backgroundColorRgb = (themeBackground || this._getThemeBackground());
    },

    _updateAlpha: function(themeBackground) {
        this.alpha = Me.settings.get_boolean('trans-use-custom-opacity') ?
                     Me.settings.get_double('trans-panel-opacity') : 
                     (themeBackground || this._getThemeBackground()).alpha * 0.003921569; // 1 / 255 = 0.003921569
    },

    _setBackground: function() {
        this.currentBackgroundColor = Utils.getrgbaColor(this.backgroundColorRgb, this.alpha);
        
        let transition = 'transition-duration: 200ms;';
        let cornerStyle = '-panel-corner-background-color: ' + this.currentBackgroundColor + transition;

        this._dtpPanel.set_style('background-color: ' + this.currentBackgroundColor + transition + this._complementaryStyles);
                
        if (this._dtpPanel.geom.position == St.Side.TOP) {
            this._dtpPanel.panel._leftCorner.actor.set_style(cornerStyle);
            this._dtpPanel.panel._rightCorner.actor.set_style(cornerStyle);
        }
    },

    _setActorStyle: function() {
        this._dtpPanel.panel.actor.set_style(
            'background: none; ' + 
            'border-image: none; ' + 
            'background-image: none;'
        );
    },

    _getThemeBackground: function(reload) {
        if (reload || !this._themeBackground) {
            let fakePanel = new St.Bin({ name: 'panel' });
            Main.uiGroup.add_child(fakePanel);
            let fakeTheme = fakePanel.get_theme_node();
            this._themeBackground = this._getBackgroundImageColor(fakeTheme) || fakeTheme.get_background_color();
            Main.uiGroup.remove_child(fakePanel);
        }

        return this._themeBackground;
    },

    _getBackgroundImageColor: function(theme) {
        let bg = null;

        try {
            let imageFile = theme.get_background_image() || theme.get_border_image().get_file();

            if (imageFile) {
                let imageBuf = GdkPixbuf.Pixbuf.new_from_file(imageFile.get_path());
                let pixels = imageBuf.get_pixels();

                bg = { red: pixels[0], green: pixels[1], blue: pixels[2], alpha: pixels[3] };
            }
        } catch (error) {}

        return bg;
    }
});
