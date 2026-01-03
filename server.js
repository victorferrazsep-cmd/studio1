const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Google Script URL
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzCA0k2P1OpYfmuDaz2rMqj4fY88Ihyr18DSba892fHCFEBd12NfBFp_v9So234dkrKYQ/exec';

// Proxy function
function proxyToGoogleScript(tab) {
  return async (req, res) => {
    try {
      const url = new URL(GOOGLE_SCRIPT_URL);
      if (tab) {
        url.searchParams.set('tab', tab);
      }
      // Add method as query param if needed
      url.searchParams.set('method', req.method);

      const options = {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          ...req.headers
        }
      };

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        options.body = JSON.stringify(req.body);
      }

      const response = await fetch(url.toString(), options);
      const data = await response.text();

      res.status(response.status).send(data);
    } catch (error) {
      console.error('Proxy error:', error);
      res.status(500).send('Internal Server Error');
    }
  };
}

// Routes
app.all('/api/cadastros', proxyToGoogleScript('Cadastros'));
app.all('/api/agenda', proxyToGoogleScript('Agenda'));
app.all('/api/anamnese', proxyToGoogleScript('Anamnese'));
app.all('/api/financeiro', proxyToGoogleScript('')); // Main sheet for financeiro

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
