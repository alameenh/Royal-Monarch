import express from 'express';
import adminController from '../controller/admin/adminController.js';
import adminMiddleware from '../middleware/adminMiddleware.js';
import userController from '../controller/admin/listUserController.js';
import categoryController from '../controller/admin/categoryController.js';
import productController from '../controller/admin/productController.js';

const router = express.Router();

router.get('/login', adminMiddleware.isLogin, adminController.getAdmin);

router.post('/login', adminController.postAdmin);

router.get('/dashboard', adminMiddleware.checkSession, adminController.getDashboard);

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

export default router; 