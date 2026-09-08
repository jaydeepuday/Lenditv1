const jwt = require('jsonwebtoken');
const token = jwt.sign({ sub: '123', email: 'test@example.com', role: 'USER' }, process.env.JWT_ACCESS_SECRET || 'lendit_access_secret_dev_change_in_prod_minimum_32_chars', { expiresIn: '15m' });
console.log("TOKEN:", token);
