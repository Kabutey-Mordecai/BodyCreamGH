'use strict';

require('dotenv').config();
const notify = require('../src/services/notification.service');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/test-sms.js <phone-number>');
  process.exit(1);
}

(async () => {
  const result = await notify.sendSms({
    to: target,
    message: 'BodyCream GH: Test SMS delivery check. Your SMS gateway is configured!',
  });
  console.log('SMS test result:', JSON.stringify(result));
  process.exit(result.sent ? 0 : 1);
})();
