'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const admin = require('firebase-admin');
const onesky = require('@brainly/onesky-utils');
const dot = require('dot-object');
const { series } = require('gulp');

// OneSky auth
const SKYAPP_PROJECT_ID = '359388';
const SKYAPP_PUBLIC_KEY = 'e0DfHgNmzrc67zt3RabZRWcYpkSISL1W';
const SKYAPP_SECRET_KEY = process.env.SKYAPP_SECRET_KEY;

// Firebase auth
const CREDENTIALS_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const getServiceAccount = () => require(path.resolve(CREDENTIALS_FILE));

// important constants
const TRANSLATION_SOURCE_FILE = 'rc.json';
const DEFAULT_LANGUAGE = 'cs';

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

exports.up = uploadStrings;
exports.uploadF = forceUploadStrings;
