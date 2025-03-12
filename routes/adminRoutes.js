import express from 'express';
import adminController from '../controller/admin/adminController.js';
import adminMiddleware from '../middleware/adminMiddleware.js';

const router = express.Router();

router.get('/login',adminMiddleware.isLogin,adminController.getAdmin );

router.post('/login',adminController.postAdmin)

router.get('/dashboard',adminMiddleware.checkSession,adminController.getDashboard)

router.get('/logout', adminMiddleware.checkSession, adminController.getLogout);

export default router 