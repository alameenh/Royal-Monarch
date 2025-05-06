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

// Public routes (no authentication required)
router.get('/', userMiddleware.isLogin, userController.getLogin);
router.get('/signup', userMiddleware.isLogin, userController.getSignup);
router.post('/signup', userController.postSignup);
router.post('/login', userController.postLogin);
router.get('/auth/google', userController.getGoogle);
router.get('/auth/google/callback', userController.getGoogleCallback);
router.get('/otpPage', userMiddleware.isLogin, userController.getOtpPage);
router.post('/verifyOtp', userMiddleware.isLogin, userController.verifyOtp);
router.post('/resendOtp', userMiddleware.isLogin, userController.resendOTP);
router.get('/forgot-password', userController.getForgotPassword);
router.post('/forgot-password', userController.postForgotPassword);
router.get('/reset-password', userController.getResetPassword);
router.post('/reset-password', userController.postResetPassword);

// Protected routes (authentication required)
router.use(userMiddleware.checkSession);
router.use(userMiddleware.getCounts);

// User routes
router.get('/logout', userController.getLogout);
router.get('/home', userController.getHomePage);
router.get('/change-password', userController.getChangePassword);
router.post('/change-password', userController.postChangePassword);

// Shop routes
router.get('/shop', shopController.getShopPage);
router.get('/shop/products', shopController.getProducts);
router.get('/shop/category/:categoryId', shopController.getShopPage);
router.get('/product/view/:productId', viewProductController.viewProduct);
router.get('/category/:categoryId/products', viewProductController.getProductsByCategory);
router.get('/products/search', viewProductController.searchProducts);
router.get('/api/products', shopController.getProducts);
router.get('/api/categories', shopController.getCategories);

// Profile routes
router.get('/profile', getProfile);
router.get('/profile/edit', getEditProfile);
router.post('/profile/update', upload.single('profileImage'), updateProfile);

// Address routes
router.get('/address', addressController.getAddressPage);
router.post('/address/add', addressController.addAddress);
router.get('/address/:id', addressController.getAddressById);
router.post('/address/update', addressController.updateAddress);
router.post('/address/delete', addressController.deleteAddress);

// Wishlist routes
router.get('/wishlist', wishlistController.getWishlist);
router.post('/wishlist/add', wishlistController.addToWishlist);
router.post('/wishlist/remove', wishlistController.removeFromWishlist);
router.get('/wishlist/count', wishlistController.getWishlistCount);

// Cart routes
router.get('/cart', cartController.getCart);
router.post('/cart/add', cartController.addToCart);
router.post('/cart/remove', cartController.removeFromCart);
router.post('/cart/update-quantity', cartController.updateQuantity);
router.get('/cart/count', cartController.getCartCount);
router.get('/cart/check', cartController.isInCart);

// Order routes
router.get('/checkout', orderController.getCheckout);
router.post('/order/create', orderController.createOrder);
router.post('/order/verify-payment', orderController.verifyPayment);
router.get('/order/success/:orderId', orderController.getOrderSuccess);
router.post('/order/:orderId/retry-payment', orderController.retryPayment);
router.get('/payment/failed/:orderId', orderController.getPaymentFailed);
router.get('/orders', orderController.getOrders);
router.post('/order/:orderId/cancel/:itemId', orderController.cancelOrderItem);
router.post('/order/:orderId/cancel', orderController.cancelOrder);
router.post('/order/:orderId/return/:itemId', orderController.requestReturn);
router.get('/order/:orderId/invoice/:itemId', orderController.generateInvoice);
router.post('/apply-coupon', orderController.applyCoupon);
router.get('/orders/search', orderController.searchOrders);

// Wallet routes
router.get('/wallet', walletController.getWallet);
router.post('/wallet/create-order', walletController.createOrder);
router.post('/wallet/verify-payment', walletController.verifyPayment);

// Product images route
router.post('/api/products/images', userController.getProductImages);

export default router;
