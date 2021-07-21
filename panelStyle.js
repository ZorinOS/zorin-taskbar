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
 * Credits:
 * This file is based on code from the Dash to Panel extension
 * Ideas for recursing child actors and assigning inline styles
 * are based on code from the StatusAreaHorizontalSpacing extension
 * https://bitbucket.org/mathematicalcoffee/status-area-horizontal-spacing-gnome-shell-extension
 * mathematical.coffee@gmail.com
 */

const Me = imports.misc.extensionUtils.getCurrentExtension();
const ExtensionUtils = imports.misc.extensionUtils;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Shell = imports.gi.Shell;

const Panel = Me.imports.panel;
const Taskbar = Me.imports.taskbar;
const Utils = Me.imports.utils;

var dtpPanelStyle = Utils.defineClass({
    Name: 'ZorinTaskbar.PanelStyle',

    _init: function() {

    },

    enable : function(panel) {
        this.panel = panel;

        this._applyStyles();
    },

    disable: function () {
        this._removeStyles();
    },

    _applyStyles: function() {
        this._rightBoxOperations = [];
      
        // center box has been moved next to the right box and will be treated the same
        this._centerBoxOperations = this._rightBoxOperations;

        this._leftBoxOperations = [];

        this._applyStylesRecursively();
        
        /* connect signal */
        this._rightBoxActorAddedID = this.panel._rightBox.connect('actor-added',
            Lang.bind(this, function (container, actor) {
                if(this._rightBoxOperations.length && !this._ignoreAddedChild)
                    this._recursiveApply(actor, this._rightBoxOperations);

                this._ignoreAddedChild = 0;
            })
        );
        this._centerBoxActorAddedID = this.panel._centerBox.connect('actor-added',
            Lang.bind(this, function (container, actor) {
                if(this._centerBoxOperations.length && !this._ignoreAddedChild)
                    this._recursiveApply(actor, this._centerBoxOperations);

                this._ignoreAddedChild = 0;
            })
        );
        this._leftBoxActorAddedID = this.panel._leftBox.connect('actor-added',
            Lang.bind(this, function (container, actor) {
                if(this._leftBoxOperations.length)
                    this._recursiveApply(actor, this._leftBoxOperations);
            })
        );
    },

    _removeStyles: function() {
        /* disconnect signal */
        if (this._rightBoxActorAddedID) 
            this.panel._rightBox.disconnect(this._rightBoxActorAddedID);
        if (this._centerBoxActorAddedID) 
            this.panel._centerBox.disconnect(this._centerBoxActorAddedID);
        if (this._leftBoxActorAddedID) 
            this.panel._leftBox.disconnect(this._leftBoxActorAddedID);

        this._restoreOriginalStyle(this.panel._rightBox);
        this._restoreOriginalStyle(this.panel._centerBox);
        this._restoreOriginalStyle(this.panel._leftBox);

        this._applyStylesRecursively(true);
    },

    _applyStylesRecursively: function(restore) {
        /*recurse actors */
        if(this._rightBoxOperations.length) {
            // add the system menu as we move it from the rightbox to the panel to position it independently
            let children = this.panel._rightBox.get_children().concat([this.panel.statusArea.aggregateMenu.container]);
            for(let i in children)
                this._recursiveApply(children[i], this._rightBoxOperations, restore);
        }

        if(this._centerBoxOperations.length) {
            // add the date menu as we move it from the centerbox to the panel to position it independently
            let children = this.panel._centerBox.get_children().concat([this.panel.statusArea.dateMenu.container]);
            for(let i in children)
                this._recursiveApply(children[i], this._centerBoxOperations, restore);
        }

        if(this._leftBoxOperations.length) {
            let children = this.panel._leftBox.get_children();
            for(let i in children)
                this._recursiveApply(children[i], this._leftBoxOperations, restore);
        }
    },

    _recursiveApply: function(actor, operations, restore) {
        for(let i in operations) {
            let o = operations[i];
            if(o.compareFn(actor))
                if(restore)
                    o.restoreFn ? o.restoreFn(actor) : this._restoreOriginalStyle(actor);
                else
                    o.applyFn(actor, i);
        }

        if(actor.get_children) {
            let children = actor.get_children();
            for(let i in children) {
                this._recursiveApply(children[i], operations, restore);
            }
        }
    },
    
    _restoreOriginalStyle: function(actor) {
        if (actor._dtp_original_inline_style !== undefined) {
            actor.set_style(actor._dtp_original_inline_style);
            delete actor._dtp_original_inline_style;
            delete actor._dtp_style_overrides;
        }

        if (actor.has_style_class_name('panel-button')) {
            this._refreshPanelButton(actor);
        }
    },

    _refreshPanelButton: function(actor) {
        if (actor.visible && imports.misc.config.PACKAGE_VERSION >= '3.34.0') {
            //force gnome 3.34+ to refresh (having problem with the -natural-hpadding)
            let parent = actor.get_parent();
            let children = parent.get_children();
            let actorIndex = 0;

            if (children.length > 1) {
                actorIndex = children.indexOf(actor);
            }

            this._ignoreAddedChild = [this.panel._centerBox, this.panel._rightBox].indexOf(parent) >= 0;

            parent.remove_child(actor);
            parent.insert_child_at_index(actor, actorIndex);
        }
    }
    
});
