const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/auth');
const userController = require('../controllers/userController');

router.get('/test', (req, res) => {
    res.json({ message: 'API is working!' });
});

//singup
router.post('/signup', userController.signup);
router.post('/confirm', userController.confirmSignup);

//login with password
router.post('/signin', userController.signInWithPassword);

//login with otp
router.post('/send-otp', userController.sendOTP);
router.post('/signin-otp', userController.signInWithOTP);

//user details
router.get('/user', authenticate, userController.getUser);

//forgot password
router.post('/forgot-password', userController.forgotPassword);
router.post('/reset-password', userController.resetPassword);

//session management
router.get('/session/status', authenticate, userController.sessionStatus);
router.post('/session/logout', authenticate, userController.logoutSession);
router.post('/session/reset', userController.resetSession);
router.post('/session/refreshToken', userController.generateTokens);

module.exports = router;