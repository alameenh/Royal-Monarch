import express from 'express';
import userController from '../controller/user/userController.js';
import shopController from '../controller/user/shopController.js';
import userMiddleware from '../middleware/userMiddleware.js';
import viewProductController from '../controller/user/viewProductController.js';
import { getProfile, getEditProfile, updateProfile, upload } from '../controller/user/profileController.js';
import addressController from '../controller/user/addressController.js';
import wishlistController from '../controller/user/wishlistController.js';
import cartController from '../controller/user/cartController.js';
import orderController from '../controller/user/orderController.js';
import walletController from '../controller/user/walletController.js';

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

router.get('/product/view/:productId', userMiddleware.checkSession, viewProductController.viewProduct);

router.get('/category/:categoryId/products', userMiddleware.checkSession, viewProductController.getProductsByCategory);

router.get('/products/search', userMiddleware.checkSession, viewProductController.searchProducts);

router.get('/api/products', userMiddleware.checkSession, shopController.getProducts);

router.get('/api/categories', userMiddleware.checkSession, shopController.getCategories);

router.get('/forgot-password', userController.getForgotPassword);

router.post('/forgot-password', userController.postForgotPassword);

router.get('/reset-password', userController.getResetPassword);

router.post('/reset-password', userController.postResetPassword);

// Profile routes
router.get('/profile', userMiddleware.checkSession, getProfile);
router.get('/profile/edit', userMiddleware.checkSession, getEditProfile);
router.post('/profile/update', userMiddleware.checkSession, upload.single('profileImage'), updateProfile);

// Address routes
router.get('/address', userMiddleware.checkSession, addressController.getAddressPage);
router.post('/address/add', userMiddleware.checkSession, addressController.addAddress);
router.get('/address/:id', userMiddleware.checkSession, addressController.getAddressById);
router.post('/address/update', userMiddleware.checkSession, addressController.updateAddress);
router.post('/address/delete', userMiddleware.checkSession, addressController.deleteAddress);

// Wishlist routes
router.post('/wishlist/toggle/:productId', userMiddleware.checkSession, viewProductController.toggleWishlist);
router.get('/wishlist', userMiddleware.checkSession, wishlistController.getWishlist);
router.delete('/wishlist/remove/:productId', userMiddleware.checkSession, wishlistController.removeFromWishlist);

// Cart routes
router.get('/cart', userMiddleware.checkSession, cartController.getCart);
router.post('/cart/add', userMiddleware.checkSession, cartController.addToCart);
router.post('/cart/remove', userMiddleware.checkSession, cartController.removeFromCart);
router.post('/cart/update-quantity', userMiddleware.checkSession, cartController.updateQuantity);
router.get('/cart/count', userMiddleware.checkSession, cartController.getCartCount);

// Add these routes
router.get('/change-password', userMiddleware.checkSession, userController.getChangePassword);
router.post('/change-password', userMiddleware.checkSession, userController.postChangePassword);

// Order routes
router.get('/checkout', userMiddleware.checkSession, orderController.getCheckout);
router.post('/order/create', userMiddleware.checkSession, orderController.createOrder);

// Order management routes
router.get('/orders', userMiddleware.checkSession, orderController.getOrders);
router.post('/order/:orderId/cancel/:itemId', userMiddleware.checkSession, orderController.cancelOrderItem);
router.post('/order/:orderId/return/:itemId', userMiddleware.checkSession, orderController.requestReturn);

// Add this route
router.get('/order/success/:orderId', userMiddleware.checkSession, orderController.getOrderSuccess);
router.get('/order/:orderId/invoice/:itemId', userMiddleware.checkSession, orderController.generateInvoice);

router.post('/apply-coupon', userMiddleware.checkSession, orderController.applyCoupon);

// Wallet routes
router.get('/wallet', userMiddleware.checkSession, walletController.getWallet);
router.post('/wallet/create-order', userMiddleware.checkSession, walletController.createOrder);
router.post('/wallet/verify-payment', userMiddleware.checkSession, walletController.verifyPayment);

router.post('/order/verify-payment', orderController.verifyPayment);

// Update the route for fetching product images
router.post('/api/products/images', userController.getProductImages);

export default router;
