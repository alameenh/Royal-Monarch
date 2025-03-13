import express from 'express';
import userController from '../controller/user/userController.js';
import shopController from '../controller/user/shopController.js';
import userMiddleware from '../middleware/userMiddleware.js';
import viewProductController from '../controller/user/viewProductController.js';

const router = express.Router();

// Auth routes
router.get('/login', userMiddleware.isLogin, userController.getLogin);
router.get('/signup', userMiddleware.isLogin, userController.getSignup);
router.get('/logout', userMiddleware.checkSession, userController.getLogout);
router.get('/auth/google', userController.getGoogle);
router.get('/auth/google/callback', userController.getGoogleCallback);

// Protected routes
router.get('/home', userMiddleware.checkSession, userController.getHomePage);
router.get('/otpPage', userMiddleware.checkSession, userController.getOtpPage);

// Shop routes
router.get('/shop', userMiddleware.checkSession, shopController.getShopPage);
router.get('/shop/products', userMiddleware.checkSession, shopController.getProducts);

// Category routes
router.get('/shop/category/:categoryId', userMiddleware.checkSession, shopController.getShopPage);

// Product viewing routes
router.get('/product/view/:productId', userMiddleware.checkSession, viewProductController.getProductDetails);
router.get('/category/:categoryId/products', userMiddleware.checkSession, viewProductController.getProductsByCategory);
router.get('/products/search', userMiddleware.checkSession, viewProductController.searchProducts);

// API routes for fetch requests
router.get('/api/products', userMiddleware.checkSession, shopController.getProducts);
router.get('/api/categories', userMiddleware.checkSession, shopController.getCategories);

// Auth API routes
router.post('/signup', userController.postSignup);
router.post('/verifyOtp', userController.verifyOtp);
router.post('/login', userController.postLogin);

// New routes for forgot password
router.get('/forgot-password', userController.getForgotPassword);
router.post('/forgot-password', userController.postForgotPassword);
router.get('/reset-password', userController.getResetPassword);
router.post('/reset-password', userController.postResetPassword);

export default router;
