import express from 'express';
import adminController from '../controller/admin/adminController.js';
import adminMiddleware from '../middleware/adminMiddleware.js';
import userController from '../controller/admin/listUserController.js';
import categoryController from '../controller/admin/categoryController.js';
import productController from '../controller/admin/productController.js';

const router = express.Router();

// Admin Authentication Routes
router.get('/login', adminMiddleware.isLogin, adminController.getAdmin);
router.post('/login', adminController.postAdmin);
router.get('/dashboard', adminMiddleware.checkSession, adminController.getDashboard);
router.get('/logout', adminMiddleware.checkSession, adminController.getLogout);

// User Management Routes
router.get('/list-users', userController.getListUser);
router.post('/user/:id/status', userController.updateUserStatus);

// Category Management Routes
router.get('/category', categoryController.getCategories);
router.post('/category', categoryController.addCategory);
router.post('/category/:id/status', categoryController.updateCategoryStatus);

// Product Management Routes
router.get('/product', 
    productController.getProducts
);

router.post('/product', 
    productController.addProduct
);


router.put('/product/:id', productController.updateProduct);

router.patch('/products/:id/toggle-status', productController.toggleProductStatus);

export default router; 