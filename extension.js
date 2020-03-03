/* exported init */
/*
 * Copyright 2014 Red Hat, Inc
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2, or (at your option)
 * any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, see <http://www.gnu.org/licenses/>.
 */
const { Clutter, Gio, GObject, St } = imports.gi;

const Background = imports.ui.background;
const ExtensionUtils = imports.misc.extensionUtils;
const Layout = imports.ui.layout;
const Main = imports.ui.main;

var IconContainer = GObject.registerClass(
class IconContainer extends St.Widget {
    _init(params) {
        super._init(params);

        this.connect('notify::scale-x', () => {
            this.queue_relayout();
        });
        this.connect('notify::scale-y', () => {
            this.queue_relayout();
        });
    }

    vfunc_get_preferred_width(forHeight) {
        let width = super.vfunc_get_preferred_width(forHeight);
        return width.map(w => w * this.scale_x);
    }

    vfunc_get_preferred_height(forWidth) {
        let height = super.vfunc_get_preferred_height(forWidth);
        return height.map(h => h * this.scale_y);
    }
});

var BackgroundLogo = GObject.registerClass({
    Properties: {
        // For compatibility with Meta.BackgroundActor
        'brightness': GObject.ParamSpec.double(
            'brightness', 'brightness', 'brightness',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
            0, 1, 1),
        'vignette-sharpness': GObject.ParamSpec.double(
            'vignette-sharpness', 'vignette-sharpness', 'vignette-sharpness',
            GObject.ParamFlags.READWRITE,
            0, 1, 0),
    },
}, class BackgroundLogo extends St.Widget {
    _init(bgManager) {
        this._bgManager = bgManager;
        this._monitorIndex = bgManager._monitorIndex;

        this._logoFile = null;

        this._settings = ExtensionUtils.getSettings();

        this._settings.connect('changed::logo-file',
            this._updateLogo.bind(this));
        this._settings.connect('changed::logo-size',
            this._updateScale.bind(this));
        this._settings.connect('changed::logo-position',
            this._updatePosition.bind(this));
        this._settings.connect('changed::logo-border',
            this._updateBorder.bind(this));
        this._settings.connect('changed::logo-opacity',
            this._updateOpacity.bind(this));
        this._settings.connect('changed::logo-always-visible',
            this._updateVisibility.bind(this));

        this._textureCache = St.TextureCache.get_default();
        this._textureCache.connect('texture-file-changed', (cache, file) => {
            if (!this._logoFile || !this._logoFile.equal(file))
                return;
            this._updateLogoTexture();
        });

        super._init({
            layout_manager: new Clutter.BinLayout(),
            opacity: 0,
        });
        bgManager._container.add_actor(this);

        this.connect('destroy', this._onDestroy.bind(this));

        this.connect('notify::brightness',
            this._updateOpacity.bind(this));

        let constraint = new Layout.MonitorConstraint({
            index: this._monitorIndex,
            work_area: true,
        });
        this.add_constraint(constraint);

        this._bin = new IconContainer({ x_expand: true, y_expand: true });
        this.add_actor(this._bin);
        this._bin.connect('notify::resource-scale',
            this._updateLogoTexture.bind(this));

        this._updateLogo();
        this._updatePosition();
        this._updateBorder();

        this._bgDestroyedId = bgManager.backgroundActor.connect('destroy',
            this._backgroundDestroyed.bind(this));

        this._bgChangedId = bgManager.connect('changed',
            this._updateVisibility.bind(this));
        this._updateVisibility();
    }

    _updateLogo() {
        let filename = this._settings.get_string('logo-file');
        let file = Gio.File.new_for_commandline_arg(filename);
        if (this._logoFile && this._logoFile.equal(file))
            return;

        this._logoFile = file;

        this._updateLogoTexture();
    }

    _updateOpacity() {
        this._bin.opacity =
            this._settings.get_uint('logo-opacity') * this.brightness;
    }

    _getWorkArea() {
        return Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex);
    }

    _getWidthForRelativeSize(size) {
        let { width } = this._getWorkArea();
        return width * size / 100;
    }

    _updateLogoTexture() {
        if (this._icon)
            this._icon.destroy();
        this._icon = null;

        let [valid, resourceScale] = this._bin.get_resource_scale();
        if (!valid)
            return;

        let key = this._settings.settings_schema.get_key('logo-size');
        let [, range] = key.get_range().deep_unpack();
        let [, max] = range.deep_unpack();
        let width = this._getWidthForRelativeSize(max);

        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._icon = this._textureCache.load_file_async(this._logoFile, width, -1, scaleFactor, resourceScale);
        this._icon.connect('notify::content',
            this._updateScale.bind(this));
        this._bin.add_actor(this._icon);
    }

    _updateScale() {
        if (!this._icon || this._icon.width === 0)
            return;

        let size = this._settings.get_double('logo-size');
        let width = this._getWidthForRelativeSize(size);
        let scale = width / this._icon.width;
        this._bin.set_scale(scale, scale);
    }

    _updatePosition() {
        let xAlign, yAlign;
        switch (this._settings.get_string('logo-position')) {
        case 'center':
            xAlign = Clutter.ActorAlign.CENTER;
            yAlign = Clutter.ActorAlign.CENTER;
            break;
        case 'bottom-left':
            xAlign = Clutter.ActorAlign.START;
            yAlign = Clutter.ActorAlign.END;
            break;
        case 'bottom-center':
            xAlign = Clutter.ActorAlign.CENTER;
            yAlign = Clutter.ActorAlign.END;
            break;
        case 'bottom-right':
            xAlign = Clutter.ActorAlign.END;
            yAlign = Clutter.ActorAlign.END;
            break;
        }
        this._bin.x_align = xAlign;
        this._bin.y_align = yAlign;
    }

    _updateBorder() {
        let border = this._settings.get_uint('logo-border');
        this.style = 'padding: %dpx;'.format(border);
    }

    _updateVisibility() {
        let background = this._bgManager.backgroundActor.background._delegate;
        let defaultUri = background._settings.get_default_value('picture-uri');
        let file = Gio.File.new_for_commandline_arg(defaultUri.deep_unpack());

        let visible;
        if (this._settings.get_boolean('logo-always-visible'))
            visible = true;
        else if (background._file)
            visible = background._file.equal(file);
        else // background == NONE
            visible = false;

        this.ease({
            opacity: visible ? 255 : 0,
            duration: Background.FADE_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _backgroundDestroyed() {
        this._bgDestroyedId = 0;

        if (this._bgManager._backgroundSource) { // background swapped
            this._bgDestroyedId =
                this._bgManager.backgroundActor.connect('destroy',
                    this._backgroundDestroyed.bind(this));
        } else { // bgManager destroyed
            this.destroy();
        }
    }

    _onDestroy() {
        this._settings.run_dispose();
        this._settings = null;

        if (this._bgDestroyedId)
            this._bgManager.backgroundActor.disconnect(this._bgDestroyedId);
        this._bgDestroyedId = 0;

        if (this._bgChangedId)
            this._bgManager.disconnect(this._bgChangedId);
        this._bgChangedId = 0;

        this._bgManager = null;

        this._logoFile = null;
    }
});


class Extension {
    constructor() {
        this._monitorsChangedId = 0;
        this._startupPreparedId = 0;
        this._logos = new Set();
    }

    _forEachBackgroundManager(func) {
        Main.overview._bgManagers.forEach(func);
        Main.layoutManager._bgManagers.forEach(func);
    }

    _addLogo() {
        this._destroyLogo();
        this._forEachBackgroundManager(bgManager => {
            let logo = new BackgroundLogo(bgManager);
            logo.connect('destroy', () => {
                this._logos.delete(logo);
            });
            this._logos.add(logo);
        });
    }

    _destroyLogo() {
        this._logos.forEach(l => l.destroy());
    }

    enable() {
        this._monitorsChangedId =
            Main.layoutManager.connect('monitors-changed', this._addLogo.bind(this));
        this._startupPreparedId =
            Main.layoutManager.connect('startup-prepared', this._addLogo.bind(this));
        this._addLogo();
    }

    disable() {
        if (this._monitorsChangedId)
            Main.layoutManager.disconnect(this._monitorsChangedId);
        this._monitorsChangedId = 0;

        if (this._startupPreparedId)
            Main.layoutManager.disconnect(this._startupPreparedId);
        this._startupPreparedId = 0;

        this._destroyLogo();
    }
}

function init() {
    return new Extension();
}
