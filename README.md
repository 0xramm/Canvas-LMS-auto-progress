# Canvas LMS Auto Progress

Chrome extension that shows a course's module/page progress for `lms.vitonline.in` and lets you mark pages done without clicking through each one.

## Install

1. Download/clone this repo (or grab the `lms-extension.zip` artifact from the [Build workflow](.github/workflows/build.yml) runs).
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this project folder (the one with `manifest.json`).
5. The extension icon appears in your toolbar.

## Usage

1. Go to [https://lms.vitonline.in/](https://lms.vitonline.in/) and sign in.
2. Open the course you want to complete, e.g. `https://lms.vitonline.in/courses/1471`.
3. Copy the course ID from the URL — the number after `/courses/` (`1471` in the example above).
4. Click the extension icon, paste the course ID into the input box, and click **Load**.
5. This loads the course's modules and page progress.
6. Click **Mark Done** on a single page to complete just that session.
7. Or click **Complete All** on a module to mark every pending page in that week/module done at once.
