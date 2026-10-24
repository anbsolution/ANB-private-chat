# ANB Private Chat

A lightweight two-person real-time text chat prototype.

## Features
- Private invitation links
- Maximum two connected participants
- WebSocket messaging
- In-memory messages
- Room cleanup after inactivity

## Requirements
- Node.js
- npm

## Run locally
npm install
npm start

Open http://127.0.0.1:3000

## Code checks
npm test

## Limitations
- Messages are stored in server memory only.
- Restarting the server clears rooms and messages.
- This prototype is not end-to-end encrypted.
- Public internet chat requires an online Node.js backend.
- GitHub Pages alone cannot host the backend.
