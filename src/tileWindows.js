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

import Meta from 'gi://Meta'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'

import * as Utils from './utils.js'

const GAP = 0

export function tileAppWindows(windows, monitorIndex) {
  if (!windows || windows.length < 2) return

  let area = Main.layoutManager.getWorkAreaForMonitor(monitorIndex)
  let count = windows.length
  let cols = Math.ceil(Math.sqrt(count))
  let rows = Math.ceil(count / cols)
  let cellWidth = Math.floor((area.width - GAP * (cols - 1)) / cols)
  let cellHeight = Math.floor((area.height - GAP * (rows - 1)) / rows)
  let workspace = Utils.getCurrentWorkspace()
  let focusedWindow = global.display.focus_window

  windows.forEach((win, i) => {
    if (!win.located_on_workspace(workspace)) win.change_workspace(workspace)

    if (win.minimized) win.unminimize()
    if (win.fullscreen) win.unmake_fullscreen()
    if (win.maximized_horizontally || win.maximized_vertically)
      win.unmaximize(Meta.MaximizeFlags.BOTH)

    let col = i % cols
    let row = Math.floor(i / cols)

    win.move_resize_frame(
      true,
      area.x + col * (cellWidth + GAP),
      area.y + row * (cellHeight + GAP),
      cellWidth,
      cellHeight,
    )
  })

  if (focusedWindow && windows.includes(focusedWindow)) focusedWindow.raise()
}
