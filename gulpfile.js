'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const admin = require('firebase-admin');
const onesky = require('@brainly/onesky-utils');

// OneSky auth
const SKYAPP_PROJECT_ID = '359388';
const SKYAPP_PUBLIC_KEY = 'e0DfHgNmzrc67zt3RabZRWcYpkSISL1W';
const SKYAPP_SECRET_KEY = process.env.SKYAPP_SECRET_KEY;

// Firebase auth
const CREDENTIALS_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const getServiceAccount = () => require(path.resolve(CREDENTIALS_FILE));

// important constants
const TRANSLATION_SOURCE_FILE = 'rc.json';
const WRAPPING_KEY = 'rc';
const RC_PREFIX = 'v2_';
const DEFAULT_LANGUAGE = 'cs';
const DEFAULT_FALLBACK = 'en';
const TRANSLATED_LANGUAGES = ['en', 'sk'];
const FALLBACK_LANGUAGE = {
    'en': DEFAULT_LANGUAGE,
    'sk': DEFAULT_LANGUAGE
};
const LANGUAGE_TO_SKYAPP = {
    'en': 'en-GB'
};
const DEFAULT_RC_LANGUAGE_VALUE = 'DEFAULT';
const LANGUAGE_TO_RC = {
    'cs': 'Cz value',
    'sk': 'Sk value',
    'en': DEFAULT_RC_LANGUAGE_VALUE
};
const GET_DEFAULTS_SUPPORTED = ['cs', 'sk'];

var currentVueKey = '';

async function uploadStrings(keepStrings = true) {
    console.log(`Sending ${TRANSLATION_SOURCE_FILE} for translation`);
    const options = {
        secret: SKYAPP_SECRET_KEY,
        apiKey: SKYAPP_PUBLIC_KEY,
        projectId: SKYAPP_PROJECT_ID,
        language: DEFAULT_LANGUAGE,
        fileName: TRANSLATION_SOURCE_FILE,
        format: 'HIERARCHICAL_JSON',
        content: fs.readFileSync(TRANSLATION_SOURCE_FILE).toString(),
        keepStrings // avoid deleting all translations with an erroneous upload
    };

    try {
        await onesky.postFile(options);
    } catch (e) {
        console.error(`Failed to upload translation: ${JSON.stringify(e)}`);
    }
}

async function forceUploadStrings() {
    await uploadStrings(false);
}

async function downloadStrings() {
    console.log(`Fetching translation of ${TRANSLATION_SOURCE_FILE}`);
    const options = {
        secret: SKYAPP_SECRET_KEY,
        apiKey: SKYAPP_PUBLIC_KEY,
        projectId: SKYAPP_PROJECT_ID,
        fileName: TRANSLATION_SOURCE_FILE,
        format: 'I18NEXT_MULTILINGUAL_JSON'
    };

    try {
        return await onesky.getMultilingualFile(options);
    } catch (e) {
        console.error(`Failed to download translation: ${JSON.stringify(e)}`);
        return '';
    }
}

async function processAndUploadDownloadedStrings() {
    const translationFile = await downloadStrings();

    if (translationFile === '') {
        return;
    }

    const content = JSON.parse(translationFile);
    var translation = {};
    const allLanguages = [...TRANSLATED_LANGUAGES, DEFAULT_LANGUAGE]

    for (const language of allLanguages) {
        const key = LANGUAGE_TO_SKYAPP[language] || language;
        let data = {};

        if (content.hasOwnProperty(key)) {
            data = content[key]['translation'];
        } else {
            console.warn(`Language ${language} not found in OneSky`);
        }

        translation[language] = data;
    }

    const processedTranslation = buildI18n(translation);
    await updateRemoteConfig(processedTranslation);
}

function buildI18n(content) {
    var resultingTranslation = {};

    for (const key of Object.keys(content)) {
        let currentTranslation = content[key];
        normalizeTranslations(content, key);
        currentVueKey = key;
        currentTranslation = processByRegex(currentTranslation);
        resultingTranslation[key] = currentTranslation;
    }

    return resultingTranslation;
}

function normalizeTranslations(translations, language) {
    const fallback = getFallback(language);
    const data = translations[language];

    if (language !== DEFAULT_LANGUAGE) {
        for (const key of Object.keys(translations[DEFAULT_LANGUAGE])) {
            if (!data.hasOwnProperty(key)) {
                data[key] = translate(translations, fallback, key);
            }
        }
    }
}

function getFallback(language) {
    if (FALLBACK_LANGUAGE.hasOwnProperty(language)) {
        return FALLBACK_LANGUAGE[language];
    }

    return DEFAULT_FALLBACK;
}

function translate(translation, language, key) {
    const strings = translation[language] || {};
    let result;

    if (strings.hasOwnProperty(key)) {
        result = strings[key];
    }

    if (result === undefined) {
        if (language === DEFAULT_LANGUAGE) {
            throw Error(`${key} not found for default language`);
        }

        const fallback = getFallback(language);
        console.warn(`${key} not found for ${language}, using ${fallback}`);
        return translate(translation, fallback, key);
    }
    return result;
}

function processByRegex(data) {
    if (Array.isArray(data)) {
        return data.map(processByRegex);
    }
    else if (typeof data === 'string') {
        // non-breaking space (nbsp)
        if (currentVueKey === 'cs' || currentVueKey === 'sk') {
            data = data.replace(/(?<=\s)([kvszaiou])\s/gi, '$1\u00A0');
        } else if (currentVueKey === 'en') {
            data = data.replace(/(?<=\s)(a|an|the)\s/gi, '$1\u00A0');
        }

        return data;
    }
    else if (typeof data === 'object' && data !== null) {
        const modified = {};

        for (const key of Object.keys(data)) {
            modified[key] = processByRegex(data[key]);
        }

        return modified;
    }
    throw Error(`Wrong type supplied to processByRegex: ${typeof data}, ${data}`);
}

async function updateRemoteConfig(translation) {
    if (CREDENTIALS_FILE === undefined) {
        console.log('GOOGLE_APPLICATION_CREDENTIALS not set, skipping remote config upload');
        return;
    }

    const values = {
        ...stringsToRemoteConfigFormat(translation)
    };

    await updateRemoteConfigValues(values);
}

function stringsToRemoteConfigFormat(translation) {
    var values = {};

    for (const language of Object.keys(translation)) {
        translation[language] = translation[language][WRAPPING_KEY];

        for (const key of Object.keys(translation[language])) {
            const rcKey = RC_PREFIX + key;
            const string = translation[language][key];
            const value = typeof string === 'object' ? JSON.stringify(string) : string;

            if (values[rcKey] === undefined) {
                values[rcKey] = {
                    defaultValue: {},
                    conditionalValues: {}
                }
            }

            if (LANGUAGE_TO_RC[language] === DEFAULT_RC_LANGUAGE_VALUE) {
                values[rcKey].defaultValue = { value };
            } else if (LANGUAGE_TO_RC[language]) {
                values[rcKey].conditionalValues[LANGUAGE_TO_RC[language]] = { value };
            }
        }
    }

    return values;
}

async function updateRemoteConfigValues(values) {
    try {
        const account = getServiceAccount();
        const firebaseProject = account.project_id;
        console.log(`Updating remote config of ${firebaseProject}`);
        const credential = admin.credential.cert(account);
        const token = (await credential.getAccessToken()).access_token;
        const config = await fetch(`https://firebaseremoteconfig.googleapis.com/v1/projects/${firebaseProject}/remoteConfig`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept-Encoding': 'gzip',
            }
        });

        if (config.status !== 200) {
            console.log(`Remote config fetch failed: ${config.status}: ${config.statusText}`);
            return;
        }

        const etag = config.headers.raw().etag[0];
        const body = await config.json();
        const parameters = body['parameters'] || {};
        const conditions = body['conditions'] || [];

        if (!isRemoteConfigDirty(body['parameters'], values)) {
            console.log('Values not changed, skipping');
            return;
        }

        for (const key of Object.keys(values)) {
            const value = values[key];

            if (value === '') {
                console.warn(`Skipping remote config key ${key} because it's empty`);
                continue;
            }

            let object;

            if (value.hasOwnProperty('defaultValue')) {
                object = value;
                if (parameters[key] !== undefined) {
                    object = parameters[key];
                }
                object = value;
            } else {
                object = {
                    defaultValue: {
                        value
                    }
                };
                if (parameters[key] !== undefined) {
                    object = parameters[key];
                }
                object.defaultValue.value = value;
            }

            parameters[key] = object;
        }

        const data = {
            parameters,
            conditions
        };
        const dataJson = JSON.stringify(data);
        const result = await fetch(`https://firebaseremoteconfig.googleapis.com/v1/projects/${firebaseProject}/remoteConfig`, {
            method: 'PUT',
            headers: {
                'Content-Length': dataJson.length,
                'Content-Type': 'application/json; UTF8',
                'Authorization': `Bearer ${token}`,
                'Accept-Encoding': 'gzip',
                'If-Match': etag
            },
            body: dataJson
        });
        const status = result.status;

        if (status === 200) {
            console.log('Remote config uploaded');
        } else {
            console.error(`Remote config upload failed: ${status}: ${result.statusText}`);
        }
    } catch (e) {
        console.error(e);
    }
}

function isRemoteConfigDirty(data, values) {
    if (data === undefined) {
        return true;
    }

    for (const key of Object.keys(values)) {
        if (data[key] === undefined || data[key]['defaultValue']['value'] !== values[key]) {
            console.log(`Key ${key} is dirty`);
            return true;
        }
    }

    return false;
}

async function getRemoteConfigValues() {
    try {
        const account = getServiceAccount();
        const firebaseProject = account.project_id;
        console.log(`Fetching remote config of ${firebaseProject}`);
        const credential = admin.credential.cert(account);
        const token = (await credential.getAccessToken()).access_token;
        const config = await fetch(`https://firebaseremoteconfig.googleapis.com/v1/projects/${firebaseProject}/remoteConfig`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept-Encoding': 'gzip',
            }
        });

        if (config.status !== 200) {
            console.log(`Remote config fetch failed: ${config.status}: ${config.statusText}`);
            return;
        }

        const body = await config.json();
        const parameters = body['parameters'] || {};

        const xmlContent = {};

        for (const key in parameters) {
            if (parameters.hasOwnProperty(key) && key.substr(0, 3) == 'v2_') {
                const element = parameters[key];

                xmlContent[DEFAULT_RC_LANGUAGE_VALUE] = xmlContent[DEFAULT_RC_LANGUAGE_VALUE] ? xmlContent[DEFAULT_RC_LANGUAGE_VALUE] : '';
                xmlContent[DEFAULT_RC_LANGUAGE_VALUE] += getTemplateForKeyValue(key, element.defaultValue.value);

                GET_DEFAULTS_SUPPORTED.forEach(defKey => {
                    const condKey = LANGUAGE_TO_RC[defKey];
                    xmlContent[condKey] = xmlContent[condKey] ? xmlContent[condKey] : '';

                    if (element.hasOwnProperty('conditionalValues') && element.conditionalValues.hasOwnProperty(condKey)) {
                        const { value } = element.conditionalValues[condKey];
                        xmlContent[condKey] += getTemplateForKeyValue(key, value);
                    } else {
                        xmlContent[condKey] += getTemplateForKeyValue(key, element.defaultValue.value);
                    }
                });
            }
        }

        const directory = 'res';
        const innerPrefix = 'xml';
        const fileName = 'remote_config_defaults.xml';

        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory);
        }

        for (const lang in xmlContent) {
            if (xmlContent.hasOwnProperty(lang)) {
                const langContent = xmlContent[lang];
                const dirName = `${directory}/${
                    lang == DEFAULT_RC_LANGUAGE_VALUE
                    ? innerPrefix
                    : `${innerPrefix}-${getKeyByValue(LANGUAGE_TO_RC, lang)}`
                }`;

                if (!fs.existsSync(dirName)) {
                    fs.mkdirSync(dirName);
                }

                fs.writeFileSync(`${dirName}/${fileName}`, getTemplateWrapper(langContent));
            }
        }

    } catch (e) {
        console.error(e);
    }
}

function getKeyByValue(obj, value) {
    return Object.keys(obj).find(key => obj[key] === value);
}

function getTemplateForKeyValue(key, value) {
    return `
    <entry>
        <key>${key}</key>
        <value>${value}</value>
    </entry>`;
}

function getTemplateWrapper(value) {
    return `<?xml version="1.0" encoding="utf-8"?>
<defaultsMap>${value}
</defaultsMap>
`;
}

exports.up = uploadStrings;
exports.uploadF = forceUploadStrings;
exports.get = getRemoteConfigValues;

exports.default = processAndUploadDownloadedStrings;
