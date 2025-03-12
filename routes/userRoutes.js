import express from 'express';
import userController from '../controller/user/userController.js';
const router = express.Router();

router.get('/',userController.getLogin);

router.get('/signup',userController.getSignup);

router.post('/register', userController.postSignup);

router.get('/otpPage',userController.getOtpPage);

router.post('/verifyOtp', userController.verifyOtp);

router.get('/', userController.getHomePage);

export default router;
