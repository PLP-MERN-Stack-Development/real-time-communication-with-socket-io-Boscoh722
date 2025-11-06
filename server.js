const express = require('express');
const app = express();
const port = 3001; // Or any port you prefer

app.get('/', (req, res) => {
  res.send('Server is running');
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
