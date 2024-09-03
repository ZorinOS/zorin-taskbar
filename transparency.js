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
const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const Config = imports.misc.config;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Panel = Me.imports.panel;
const Proximity = Me.imports.proximity;
const Utils = Me.imports.utils;

const TRANS_DYNAMIC_DISTANCE = 20;

var DynamicTransparency = class {

    constructor(dtpPanel) {
        this._dtpPanel = dtpPanel;
        this._proximityManager = dtpPanel.panelManager.proximityManager;
        this._proximityWatchId = 0;
        this.currentBackgroundColor = 0;

        this._initialPanelStyle = dtpPanel.panel.get_style();

        this._signalsHandler = new Utils.GlobalSignalsHandler();
        this._bindSignals();

        this._updateAllAndSet();
        this._updateProximityWatch();
    }

    destroy() {
        this._signalsHandler.destroy();
        this._proximityManager.removeWatch(this._proximityWatchId);

        this._dtpPanel.panel.set_style(this._initialPanelStyle);
    }

    updateExternalStyle() {
        this._updateComplementaryStyles();
        this._setBackground();
    }

    _bindSignals() {
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
                    'changed::trans-panel-opacity',
                    'changed::trans-dynamic-anim-target',
                    'changed::trans-use-dynamic-opacity'
                ],
                () => this._updateAlphaAndSet()
            ],
            [
                Me.settings,
                [
                    'changed::trans-dynamic-behavior',
                    'changed::trans-use-dynamic-opacity'
                ],
                () => this._updateProximityWatch()
            ]
        );
    }

    _updateProximityWatch() {
        this._proximityManager.removeWatch(this._proximityWatchId);

        if (Me.settings.get_boolean('trans-use-dynamic-opacity')) {
            let isVertical = this._dtpPanel.checkIfVertical();
            let threshold = TRANS_DYNAMIC_DISTANCE;

            this._windowOverlap = false;
            this._updateAlphaAndSet()

            this._proximityWatchId = this._proximityManager.createWatch(
                this._dtpPanel.panelBox.get_parent(),
                this._dtpPanel.monitor.index,
                Proximity.Mode[Me.settings.get_string('trans-dynamic-behavior')], 
                isVertical ? threshold : 0, 
                isVertical ? 0 : threshold, 
                overlap => { 
                    this._windowOverlap = overlap;
                    this._updateAlphaAndSet();
                }
            );
        }
    }

    _updateAllAndSet() {
        let themeBackground = this._getThemeBackground(true);

        this._updateColor(themeBackground);
        this._updateAlpha(themeBackground);
        this._updateComplementaryStyles();
        this._setBackground();
        this._setActorStyle();
    }

    _updateAlphaAndSet() {
        this._updateAlpha();
        this._setBackground();
    }

    _updateComplementaryStyles() {
        let panelThemeNode = this._dtpPanel.panel.get_theme_node();

        this._complementaryStyles = 'border-radius: ' + panelThemeNode.get_border_radius(0) + 'px;';
    }

    _updateColor(themeBackground) {
        this.backgroundColorRgb = themeBackground || this._getThemeBackground();
    }

    _updateAlpha(themeBackground) {
        if (this._windowOverlap && !Main.overview.visibleTarget && Me.settings.get_boolean('trans-use-dynamic-opacity')) {
            this.alpha = Me.settings.get_double('trans-dynamic-anim-target');
        } else {
            this.alpha = Me.settings.get_boolean('trans-use-custom-opacity') ?
                         Me.settings.get_double('trans-panel-opacity') : 
                         (themeBackground || this._getThemeBackground()).alpha * 0.003921569; // 1 / 255 = 0.003921569
        }
    }

    _setBackground() {
        this.currentBackgroundColor = Utils.getrgbaColor(this.backgroundColorRgb, this.alpha);

        let transition = 'transition-duration: 300ms;';

        this._dtpPanel.set_style('background-color: ' + this.currentBackgroundColor + transition + this._complementaryStyles);
    }

    _setActorStyle() {
        this._dtpPanel.panel.set_style(
            'background: none; ' + 
            'border-image: none; ' + 
            'background-image: none; ' +
            'transition-duration: 300ms;'
        );
    }

    _getThemeBackground(reload) {
        if (reload || !this._themeBackground) {
            let fakePanel = new St.Bin({ name: 'panel' });
            Main.uiGroup.add_child(fakePanel);
            let fakeTheme = fakePanel.get_theme_node()
            this._themeBackground = this._getBackgroundImageColor(fakeTheme) || fakeTheme.get_background_color();
            Main.uiGroup.remove_child(fakePanel);
        }

        return this._themeBackground;
    }

    _getBackgroundImageColor(theme) {
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
}
