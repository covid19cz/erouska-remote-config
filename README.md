# erouska-remote-config

Automatization for localized Remote Config strings for Android &amp; iOS apps

## How to add new localizable RC key
1. Add it to `rc.json` in this repo
2. This automatically pushes it to OneSky, ask translators for translations
3. Once translations are done, [run this workflow](https://github.com/covid19cz/erouska-remote-config/actions/workflows/rc-development.yml)
4. Test translations in DEV app
5. If it's OK, [run this workflow](https://github.com/covid19cz/erouska-remote-config/actions/workflows/rc-production.yml)
6. Then run workflows for [iOS](https://github.com/covid19cz/erouska-remote-config/actions/workflows/get-defaults-ios.yml) or [Android](https://github.com/covid19cz/erouska-remote-config/actions/workflows/get-defaults.yml). Artifact will contains defaults, push them to code.

## How to add new non-localizable RC key
1. Add it to PROD RC
2. Then run workflows for [iOS](https://github.com/covid19cz/erouska-remote-config/actions/workflows/get-defaults-ios.yml) or [Android](https://github.com/covid19cz/erouska-remote-config/actions/workflows/get-defaults.yml). Artifact will contains defaults, push them to code.
