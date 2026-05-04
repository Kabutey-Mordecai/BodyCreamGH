'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const nodemailer = require('nodemailer');

const recipient = process.argv[2] || process.env.SMTP_USER;

if (!recipient) {
  console.error('Usage: node scripts/test-email.js [recipient@example.com]');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

console.log('SMTP config:');
console.log(`  Host : ${process.env.SMTP_HOST}`);
console.log(`  Port : ${process.env.SMTP_PORT}`);
console.log(`  User : ${process.env.SMTP_USER}`);
console.log(`  Pass : ${process.env.SMTP_PASS ? '*** (set)' : '(NOT SET)'}`);
console.log(`  To   : ${recipient}`);
console.log('');
console.log('Verifying connection…');

transporter.verify()
  .then(() => {
    console.log('Connection OK — sending test email…');
    return transporter.sendMail({
      from:    `"BodyCream GH Test" <${process.env.SMTP_USER}>`,
      to:      recipient,
      subject: 'Test email from BodyCream GH',
      text:    'If you received this, SMTP is working correctly.',
      html:    '<p>If you received this, <strong>SMTP is working correctly.</strong></p>',
    });
  })
  .then(info => {
    console.log('Email sent successfully!');
    console.log(`  Message ID : ${info.messageId}`);
    console.log(`  Accepted   : ${info.accepted?.join(', ')}`);
  })
  .catch(err => {
    console.error('Failed:', err.message);
    if (err.code) console.error('  Code:', err.code);
    if (err.response) console.error('  SMTP response:', err.response);
    process.exit(1);
  });
