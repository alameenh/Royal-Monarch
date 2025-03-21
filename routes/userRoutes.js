import express from 'express';
import userController from '../controller/user/userController.js';
import shopController from '../controller/user/shopController.js';
import userMiddleware from '../middleware/userMiddleware.js';
import viewProductController from '../controller/user/viewProductController.js';
import { profileController, upload } from '../controller/user/profileController.js';
import addressController from '../controller/user/addressController.js';


const router = express.Router();


router.get('/', userMiddleware.isLogin, userController.getLogin);

router.get('/signup', userMiddleware.isLogin, userController.getSignup);

router.post('/signup', userController.postSignup);

router.post('/login', userController.postLogin);

router.get('/logout', userMiddleware.checkSession, userController.getLogout);

router.get('/auth/google', userController.getGoogle);

router.get('/auth/google/callback', userController.getGoogleCallback);

router.get('/home', userMiddleware.checkSession, userController.getHomePage);

router.get('/otpPage', userMiddleware.checkSession, userController.getOtpPage);

router.post('/verifyOtp', userController.verifyOtp);

router.get('/shop', userMiddleware.checkSession, shopController.getShopPage);

router.get('/shop/products', userMiddleware.checkSession, shopController.getProducts);

router.get('/shop/category/:categoryId', userMiddleware.checkSession, shopController.getShopPage);

router.get('/product/view/:productId', userMiddleware.checkSession, viewProductController.getProductDetails);

router.get('/category/:categoryId/products', userMiddleware.checkSession, viewProductController.getProductsByCategory);

router.get('/products/search', userMiddleware.checkSession, viewProductController.searchProducts);

router.get('/api/products', userMiddleware.checkSession, shopController.getProducts);

router.get('/api/categories', userMiddleware.checkSession, shopController.getCategories);

router.get('/forgot-password', userController.getForgotPassword);

router.post('/forgot-password', userController.postForgotPassword);

router.get('/reset-password', userController.getResetPassword);

router.post('/reset-password', userController.postResetPassword);

router.get('/profile', userMiddleware.checkSession, profileController.getProfile);
router.get('/profile/edit', userMiddleware.checkSession, profileController.getEditProfile);
router.post('/profile/update', userMiddleware.checkSession, upload.single('profileImage'), profileController.updateProfile);

// Address routes
router.get('/address', userMiddleware.checkSession, addressController.getAddressPage);
router.post('/address/add', userMiddleware.checkSession, addressController.addAddress);
router.get('/address/:id', userMiddleware.checkSession, addressController.getAddressById);
router.post('/address/update', userMiddleware.checkSession, addressController.updateAddress);
router.post('/address/delete', userMiddleware.checkSession, addressController.deleteAddress);

export default router;
