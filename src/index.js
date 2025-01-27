/* eslint-disable linebreak-style */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const sha512 = require('js-sha512');
const axios = require('axios');
const {encode, decode} = require('gpt-3-encoder');
const schedule = require('node-schedule');

const logPath = path.join(__dirname, './iplog.json');
const reqCounter = path.join(__dirname, './reqCount.txt');

const API_KEY = process.env.REACT_APP_OPENAI_API_KEY;
const URL = 'https://api.openai.com/v1/engines/davinci/completions';
const filterURL = 'https://api.openai.com/v1/engines/content-filter-alpha-c4/completions';
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.API_KEY}`,
};

if (!process.env.API_KEY || !process.env.AUTH_KEY || !process.env.ADMIN_KEY || !process.env.USER_LIMIT || !process.env.TOKEN_LIMIT) return console.error('Please set all the required env vars: API_KEY AUTH_KEY ADMIN_KEY USER_LIMIT TOKEN_LIMIT');

try {
  fs.readFileSync(logPath, 'utf-8');
} catch (err) {
  console.log('log file error. creating');
  fs.writeFileSync(logPath, '{}');
}
try {
  fs.readFileSync(reqCounter, 'utf-8');
} catch (err) {
  console.log('counter file error. creating');
  fs.writeFileSync(reqCounter, '0');
}

const job = schedule.scheduleJob('0 * * * *', () => {
  fs.writeFileSync(reqCounter, '0');
  fs.writeFileSync(logPath, '{}');
});

async function checkLimit(ip) {
  const reqCountBuffer = await fs.readFileSync(reqCounter, 'utf-8');
  const count = parseInt(reqCountBuffer, 10);
  if (count > parseInt(process.env.TOKEN_LIMIT, 10)) return -1
  const ipHash = await sha512(ip);
  console.log(ipHash);
  const ipLog = await fs.readFileSync(logPath, 'utf-8');
  const knownIps = await JSON.parse(ipLog);
  if (knownIps.hasOwnProperty(ipHash)) {
    knownIps[ipHash] += 1;
  } else {
    knownIps[ipHash] = 1;
  }
  await fs.writeFileSync(logPath, JSON.stringify(knownIps));
  return knownIps[ipHash];
}

async function addCounter(amount) {
  const reqCountBuffer = await fs.readFileSync(reqCounter, 'utf-8');
  let count = parseInt(reqCountBuffer, 10);
  count += amount;
  await fs.writeFileSync(reqCounter, count.toString());
} 

// Erstellt Express Anwendung
const app = express();
app.use(express.json());
app.use(cors());

app.post('/solveProblem', async (req, res) => {
  if (req.headers.authorization !== process.env.AUTH_KEY) return res.status(401).send();
  const count = await checkLimit(req.header('x-forwarded-for').split(',')[0]);
  console.log(count);
  if (count === -1) return res.status(429).send('max amount of brainstorms reached for this hour');
  if (count > process.env.USER_LIMIT) return res.status(429).send('you reached your limit');
  axios.post(URL, req.body, { headers })
    .then(async (r) => {
      const encoded = encode(r.data.choices[0].text)
      await addCounter(encoded.length);
      await res.status(200).send(r.data);
    })
    .catch(() => res.status(500).send('internal server error'));
  return true;
});

app.post('/filterData', (req, res) => {
  if (req.headers.authorization !== process.env.AUTH_KEY) return res.status(401).send();
  axios.post(filterURL, req.body, { headers })
    .then((r) => res.status(200).send(r.data))
    .catch((err) => {
      console.log(err);
      res.status(500).send('internal server error')
    });
});

app.post('/resetIP', async (req, res) => {
  if (req.headers.authorization !== process.env.ADMIN_KEY) return res.status(401).send();
  const ipHash = await sha512(req.header('x-forwarded-for').split(',')[0]);
  const ipLog = await fs.readFileSync(logPath, 'utf-8');
  const knownIps = await JSON.parse(ipLog);
  knownIps[ipHash] = 0;
  await fs.writeFileSync(logPath, JSON.stringify(knownIps));
  await res.status(200).send(`resetted counter for ${req.header('x-forwarded-for').split(',')[0]}`);
});

// startet Server
const server = http.createServer(app);
server.listen(3000);
// eslint-disable-next-line no-console
console.log(Date.now(), 'Server gestartet @ 3000');