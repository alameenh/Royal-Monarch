import express from 'express';
import adminController from '../controller/admin/adminController.js';
import adminMiddleware from '../middleware/adminMiddleware.js';
import userController from '../controller/admin/listUserController.js';
import categoryController from '../controller/admin/categoryController.js';
import productController from '../controller/admin/productController.js';
import orderController from '../controller/admin/adminOrderController.js';
import offerController from '../controller/admin/offerController.js';
import couponController from '../controller/admin/couponController.js';
import salesController from '../controller/admin/salesController.js';
import { getHomeSettings, updateHeroImage, updateCategoryImage, updateCategoryAssignment, updateHandpickedProducts, updateHandpickedProduct } from '../controller/admin/homeSettingsController.js';

const router = express.Router();

router.get('/login', adminMiddleware.isLogin, adminController.getAdmin);

router.post('/login', adminController.postAdmin);

router.get('/dashboard', adminMiddleware.checkSession, adminController.getDashboard);
router.get('/dashboard/chart-data', adminMiddleware.checkSession, adminController.getChartData);

router.get('/logout', adminMiddleware.checkSession, adminController.getLogout);

router.get('/list-users', adminMiddleware.checkSession, userController.getListUser);

router.post('/user/:id/status',adminMiddleware.checkSession , userController.updateUserStatus);

router.get('/category', adminMiddleware.checkSession, categoryController.getCategories);

router.post('/category', adminMiddleware.checkSession, categoryController.addCategory);

router.put('/category/:id', adminMiddleware.checkSession, categoryController.updateCategory);

router.patch('/category/:id/status', adminMiddleware.checkSession, categoryController.updateCategoryStatus);

router.get('/product', adminMiddleware.checkSession, productController.getProducts);

router.post('/product', adminMiddleware.checkSession, productController.addProduct);

router.put('/product/:id', adminMiddleware.checkSession, productController.updateProduct);

router.patch('/products/:id/toggle-status', adminMiddleware.checkSession, productController.toggleProductStatus);

router.get('/orders', adminMiddleware.checkSession, orderController.getOrders);
router.get('/orders/search', adminMiddleware.checkSession, orderController.searchOrders);
router.patch('/orders/:orderId/status', adminMiddleware.checkSession, orderController.updateOrderStatus);

router.get('/offers', adminMiddleware.checkSession, offerController.getOffers);
router.post('/offers', adminMiddleware.checkSession, offerController.createOffer);
router.put('/offers/:id', adminMiddleware.checkSession, offerController.updateOffer);
router.delete('/offers/:id', adminMiddleware.checkSession, offerController.deleteOffer);
router.get('/offers/search-products', offerController.searchProducts);
router.patch('/offers/:id/toggle-status', offerController.toggleOfferStatus);

// Coupon Management Routes
router.get('/coupons', adminMiddleware.checkSession, couponController.getCoupons);
router.post('/coupons', adminMiddleware.checkSession, couponController.createCoupon);
router.get('/coupons/:id', adminMiddleware.checkSession, couponController.getCoupon);
router.put('/coupons/:id', adminMiddleware.checkSession, couponController.updateCoupon);
router.delete('/coupons/:id', adminMiddleware.checkSession, couponController.deleteCoupon);
router.patch('/coupons/:id/toggle-status', adminMiddleware.checkSession, couponController.toggleCouponStatus);

// Sales Report Routes
router.get('/sales-report', adminMiddleware.checkSession, salesController.getSalesReport);
router.get('/sales-report/download-pdf', adminMiddleware.checkSession, salesController.downloadPDF);
router.get('/sales-report/download-excel', adminMiddleware.checkSession, salesController.downloadExcel);

// Home Settings Routes
router.get('/home-settings', adminMiddleware.checkSession, getHomeSettings);
router.post('/home-settings/hero', adminMiddleware.checkSession, updateHeroImage);
router.post('/home-settings/category', adminMiddleware.checkSession, updateCategoryImage);
router.post('/home-settings/category/assignment', adminMiddleware.checkSession, updateCategoryAssignment);
router.post('/home-settings/handpicked-products', adminMiddleware.checkSession, updateHandpickedProducts);
router.post('/home-settings/handpicked-product', adminMiddleware.checkSession, updateHandpickedProduct);

export default router;