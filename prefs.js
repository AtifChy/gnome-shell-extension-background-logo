/* exported init, buildPrefsWidget */
const { Gdk, GdkPixbuf, Gio, GnomeDesktop, GObject, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;

const BACKGROUND_SCHEMA = 'org.gnome.desktop.background';

const PREVIEW_WIDTH = 400;

let BackgroundLogoPrefsWidget = GObject.registerClass(
class BackgroundLogoPrefsWidget extends Gtk.Grid {
    _init() {
        super._init({
            halign: Gtk.Align.CENTER,
            margin: 24,
            column_spacing: 12,
            row_spacing: 6,
        });

        this.connect('screen-changed', this._onScreenChanged.bind(this));

        this._settings = ExtensionUtils.getSettings();
        this._settings.connect('changed', (settings, key) => {
            if (key === 'logo-file' ||
                key === 'logo-size')
                this._logo = null;
            this._preview.queue_draw();
        });

        this._preview = new Gtk.DrawingArea({
            halign: Gtk.Align.CENTER,
            margin_bottom: 18,
        });
        this._preview.connect('draw', this._drawPreview.bind(this));
        this.attach(this._preview, 0, 0, 2, 1);

        let filter = new Gtk.FileFilter();
        filter.add_pixbuf_formats();

        let fileChooser = new Gtk.FileChooserButton({
            title: 'Select an Image',
            filter,
        });
        fileChooser.set_filename(this._settings.get_string('logo-file'));
        fileChooser.connect('file-set',  () => {
            this._settings.set_string('logo-file', fileChooser.get_filename());
        });
        this._addRow(1, 'Logo image', fileChooser);

        let comboBox = new Gtk.ComboBoxText();
        comboBox.append('center', 'Center');
        comboBox.append('bottom-left', 'Bottom left');
        comboBox.append('bottom-center', 'Bottom center');
        comboBox.append('bottom-right', 'Bottom right');
        this._settings.bind('logo-position',
            comboBox, 'active-id',
            Gio.SettingsBindFlags.DEFAULT);
        this._addRow(2, 'Position', comboBox);

        let adjustment = this._createAdjustment('logo-size', 0.25);
        let scale = new Gtk.Scale({ adjustment, draw_value: false });
        this._addRow(3, 'Size', scale);

        adjustment = this._createAdjustment('logo-border', 1.0);
        scale = new Gtk.Scale({ adjustment, draw_value: false });
        this._addRow(4, 'Border', scale);

        adjustment = this._createAdjustment('logo-opacity', 1.0);
        scale = new Gtk.Scale({ adjustment, draw_value: false });
        this._addRow(5, 'Opacity', scale);

        let checkWidget = new Gtk.CheckButton({
            label: 'Show for all backgrounds',
        });
        this._settings.bind('logo-always-visible',
            checkWidget, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        this.attach(checkWidget, 1, 6, 1, 1);
    }

    _addRow(row, label, widget) {
        let margin = 48;

        widget.margin_end = margin;
        widget.hexpand = true;

        if (!this._sizeGroup) {
            this._sizeGroup = new Gtk.SizeGroup({
                mode: Gtk.SizeGroupMode.VERTICAL,
            });
        }
        this._sizeGroup.add_widget(widget);

        this.attach(new Gtk.Label({
            label,
            xalign: 1.0,
            margin_start: margin,
        }), 0, row, 1, 1);
        this.attach(widget, 1, row, 1, 1);
    }

    _createAdjustment(key, step) {
        let schemaKey = this._settings.settings_schema.get_key(key);
        let [type, variant] = schemaKey.get_range().deep_unpack();
        if (type !== 'range')
            throw new Error('Invalid key type "%s" for adjustment'.format(type));
        let [lower, upper] = variant.deep_unpack();
        let adj = new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: 10 * step,
        });
        this._settings.bind(key, adj, 'value', Gio.SettingsBindFlags.DEFAULT);
        return adj;
    }

    _drawPreview(preview, cr) {
        let width = preview.get_allocated_width();
        let height = preview.get_allocated_height();

        if (!this._background)
            this._createBackgroundThumbnail(width, height);
        Gdk.cairo_set_source_pixbuf(cr, this._background, 0, 0);
        cr.paint();

        if (!this._logo)
            this._createLogoThumbnail(width);

        let [x, y] = this._getLogoPosition(width, height);
        Gdk.cairo_set_source_pixbuf(cr, this._logo, x, y);
        cr.paintWithAlpha(this._settings.get_uint('logo-opacity') / 255.0);
    }

    _createBackgroundThumbnail(width, height) {
        let settings = new Gio.Settings({ schema_id: BACKGROUND_SCHEMA });
        let uri = settings.get_default_value('picture-uri').deep_unpack();
        let file = Gio.File.new_for_commandline_arg(uri);

        if (uri.endsWith('.xml')) {
            let slideShow = new GnomeDesktop.BGSlideShow({ file });
            slideShow.load();

            let [progress_, duration_, isFixed_, filename1, filename2_] =
                slideShow.get_current_slide(width, height);
            file = Gio.File.new_for_commandline_arg(filename1);
        }
        let pixbuf = GdkPixbuf.Pixbuf.new_from_file(file.get_path());
        this._background = pixbuf.scale_simple(
            width, height, GdkPixbuf.InterpType.BILINEAR);
    }

    _createLogoThumbnail(width) {
        let filename = this._settings.get_string('logo-file');
        let file = Gio.File.new_for_commandline_arg(filename);
        let pixbuf = GdkPixbuf.Pixbuf.new_from_file(file.get_path());
        let size = this._settings.get_double('logo-size') / 100;
        let ratio = pixbuf.get_width() / pixbuf.get_height();
        this._logo = pixbuf.scale_simple(
            size * width,
            size * width / ratio,
            GdkPixbuf.InterpType.BILINEAR);
    }

    _getLogoPosition(width, height) {
        let scaledBorder = this._settings.get_uint('logo-border') * this._scale;
        let x, y;
        switch (this._settings.get_string('logo-position')) {
        case 'center':
            x = (width - this._logo.get_width()) / 2;
            y = (height - this._logo.get_height()) / 2;
            break;
        case 'bottom-left':
            x = scaledBorder;
            y = height - this._logo.get_height() - scaledBorder;
            break;
        case 'bottom-center':
            x = (width - this._logo.get_width()) / 2;
            y = height - this._logo.get_height() - scaledBorder;
            break;
        case 'bottom-right':
            x = width - this._logo.get_width() - scaledBorder;
            y = height - this._logo.get_height() - scaledBorder;
            break;
        }
        return [x, y];
    }

    _onScreenChanged() {
        let screen = this.get_screen();
        if (!screen)
            return;

        let rect = screen.get_monitor_geometry(screen.get_primary_monitor());

        // If we can't get the actual geometry (wayland), use sane fallbacks
        if (rect.width === 0 || rect.height === 0) {
            rect.width = PREVIEW_WIDTH;
            rect.height = PREVIEW_WIDTH * 9 / 16;
        }

        this._scale = PREVIEW_WIDTH / rect.width;
        this._preview.set_size_request(
            PREVIEW_WIDTH,
            PREVIEW_WIDTH * rect.height / rect.width);
    }
});

function init() {
}

function buildPrefsWidget() {
    let widget = new BackgroundLogoPrefsWidget();
    widget.show_all();

    return widget;
}
