# Basic Makefile

UUID = zorin-taskbar@zorinos.com
MODULES = src/*.js src/stylesheet.css metadata.json COPYING README.md
UI_MODULES = ui/*.ui
IMAGES = ./*

TOLOCALIZE = src/extension.js src/prefs.js src/appIcons.js src/taskbar.js
MSGSRC = $(wildcard po/*.po)
ifeq ($(strip $(DESTDIR)),)
	INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
else
	INSTALLBASE = $(DESTDIR)/usr/share/gnome-shell/extensions
endif
INSTALLNAME = zorin-taskbar@zorinos.com

# The command line passed variable VERSION is used to set the version string
# in the metadata and in the generated zip-file.
ifdef VERSION
else
	VERSION = 65
endif

ifdef TARGET
	FILESUFFIX = _v$(VERSION)_$(TARGET)
else
	FILESUFFIX = _v$(VERSION)
endif

all: extension

clean:
	rm -f ./schemas/gschemas.compiled

extension: ./schemas/gschemas.compiled $(MSGSRC:.po=.mo)

./schemas/gschemas.compiled: ./schemas/org.gnome.shell.extensions.zorin-taskbar.gschema.xml
	glib-compile-schemas ./schemas/

potfile: ./po/zorin-taskbar.pot

mergepo: potfile
	for l in $(MSGSRC); do \
		msgmerge -U $$l ./po/zorin-taskbar.pot; \
	done;

./po/zorin-taskbar.pot: $(TOLOCALIZE)
	mkdir -p po
	xgettext -k_ -kN_ -o po/zorin-taskbar.pot --package-name "Zorin Taskbar" $(TOLOCALIZE) --from-code=UTF-8

	for l in $(UI_MODULES) ; do \
		intltool-extract --type=gettext/glade $$l; \
		xgettext -k_ -kN_ -o po/zorin-taskbar.pot $$l.h --join-existing --from-code=UTF-8; \
		rm -rf $$l.h; \
	done;

	sed -i -e 's/&\#10;/\\n/g' po/zorin-taskbar.pot

./po/%.mo: ./po/%.po
	msgfmt -c $< -o $@

install: install-local

install-local: _build
	rm -rf $(INSTALLBASE)/$(INSTALLNAME)
	mkdir -p $(INSTALLBASE)/$(INSTALLNAME)
	cp -r ./_build/* $(INSTALLBASE)/$(INSTALLNAME)/
	-rm -fR _build
	echo done

zip-file: _build
	cd _build ; \
	zip -qr "$(UUID)$(FILESUFFIX).zip" .
	mv _build/$(UUID)$(FILESUFFIX).zip ./
	-rm -fR _build

_build: all
	-rm -fR ./_build
	mkdir -p _build
	cp $(MODULES) _build
	mkdir -p _build/ui
	cp $(UI_MODULES) _build/ui

	mkdir -p _build/img
	cd img ; cp $(IMAGES) ../_build/img/
	mkdir -p _build/schemas
	cp schemas/*.xml _build/schemas/
	cp schemas/gschemas.compiled _build/schemas/
	mkdir -p _build/locale
	for l in $(MSGSRC:.po=.mo) ; do \
		lf=_build/locale/`basename $$l .mo`; \
		mkdir -p $$lf; \
		mkdir -p $$lf/LC_MESSAGES; \
		cp $$l $$lf/LC_MESSAGES/zorin-taskbar.mo; \
	done;
ifneq ($(and $(COMMIT),$(VERSION)),)
	sed -i 's/"version": [[:digit:]][[:digit:]]*/"version": $(VERSION),\n"commit": "$(COMMIT)"/'  _build/metadata.json;
else ifneq ($(VERSION),)
	sed -i 's/"version": [[:digit:]][[:digit:]]*/"version": $(VERSION)/'  _build/metadata.json;
endif
