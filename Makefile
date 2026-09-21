# One-command targets for the dbw extension. Each runs the npm workspace
# scripts underneath; the version comes from the extension manifest.

VERSION := $(shell node -p "require('./packages/extension/package.json').version")
VSIX    := packages/extension/dbw-$(VERSION).vsix
DESKTOP := $(shell cmd.exe /c "echo %USERPROFILE%" 2>/dev/null | tr -d '\r' | sed 's#\\#/#g; s#^C:#/mnt/c#')/Desktop

.PHONY: build install stage

## Typecheck, test, bundle and package the .vsix
build:
	npm run typecheck
	npm test
	npm run package

## Install the packaged .vsix into the running VS Code
install: $(VSIX)
	code --install-extension $(VSIX) --force

## Copy the .vsix to the Windows Desktop for manual Marketplace upload
stage: $(VSIX)
	cp $(VSIX) "$(DESKTOP)/"
	@echo "Staged $(DESKTOP)/dbw-$(VERSION).vsix"
	@echo "Upload at https://marketplace.visualstudio.com/manage/publishers/sajonaro"

$(VSIX):
	$(MAKE) build
