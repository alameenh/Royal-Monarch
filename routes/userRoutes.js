import express from 'express';
import userController from '../controller/user/userController.js';
import userMiddleware from '../middleware/userMiddleware.js';

const router = express.Router();

// Apply isLogin middleware to routes that should not be accessible when logged in
router.get('/login', userMiddleware.isLogin, userController.getLogin);
router.get('/signup', userMiddleware.isLogin, userController.getSignup);

// Apply checkSession middleware to routes that require authentication
router.get('/home', userMiddleware.checkSession, userController.getHomePage);
router.get('/otpPage', userMiddleware.checkSession, userController.getOtpPage);

// Public routes
router.post('/signup', userController.postSignup);
router.post('/verifyOtp', userController.verifyOtp);

export default router;
