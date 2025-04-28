import HomeSettings from '../../model/homeSettingsModel.js';
import { uploadImage, deleteImage } from '../../utils/imageUpload.js';
import Category from '../../model/categoryModel.js';
import Product from '../../model/productModel.js';
import multer from 'multer';
import path from 'path';
import mongoose from 'mongoose';

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

export const getHomeSettings = async (req, res) => {
    try {
        const settings = await HomeSettings.findOne();
        const allCategories = await Category.find({ status: 'Active' });
        const products = await Product.find({ status: 'Active' }).select('_id name images');
        res.render('admin/homeSettings', { settings, allCategories, products });
    } catch (error) {
        console.error('Error fetching home settings:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch home settings' });
    }
};

export const updateHeroImage = async (req, res) => {
    try {
        upload.single('image')(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Error uploading file: ' + err.message 
                });
            }

            let settings = await HomeSettings.findOne();
            if (!settings) {
                settings = new HomeSettings();
            }

            if (!req.file) {
                if (settings.heroImage) {
                    await deleteImage(settings.heroImage);
                }
                settings.heroImage = '';
            } else {
                if (settings.heroImage) {
                    await deleteImage(settings.heroImage);
                }
                const imageUrl = await uploadImage(req.file.buffer, { 
                    type: 'hero',
                    dimensions: {
                        width: 1920,
                        height: 1080
                    }
                });
                settings.heroImage = imageUrl;
            }

            await settings.save();
            res.json({ success: true, imageUrl: settings.heroImage });
        });
    } catch (error) {
        console.error('Error updating hero image:', error);
        res.status(500).json({ success: false, message: 'Failed to update hero image' });
    }
};

export const updateCategoryImage = async (req, res) => {
    try {
        upload.single('image')(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Error uploading file: ' + err.message 
                });
            }

            const { category, removeImage } = req.body;
            if (!category) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Category is required' 
                });
            }

            let settings = await HomeSettings.findOne();
            if (!settings) {
                settings = new HomeSettings();
            }

            // Handle image removal
            if (removeImage === 'true') {
                const oldImage = settings[`${category}CategoryImage`];
                if (oldImage) {
                    await deleteImage(oldImage);
                }
                settings[`${category}CategoryImage`] = '';
                await settings.save();
                
                // Prepare response with category images
                const categoryImages = {
                    left: settings.leftCategoryImage,
                    right: settings.rightCategoryImage,
                    top: settings.topCategoryImage,
                    bottom: settings.bottomCategoryImage
                };
                
                return res.json({ 
                    success: true, 
                    categoryImages
                });
            }

            // Handle image upload
            if (!req.file) {
                const oldImage = settings[`${category}CategoryImage`];
                if (oldImage) {
                    await deleteImage(oldImage);
                }
                settings[`${category}CategoryImage`] = '';
            } else {
                const oldImage = settings[`${category}CategoryImage`];
                if (oldImage) {
                    await deleteImage(oldImage);
                }
                const imageUrl = await uploadImage(req.file.buffer, { 
                    type: 'category',
                    dimensions: category === 'left' || category === 'right' 
                        ? { width: 800, height: 900 }
                        : { width: 387, height: 215 }
                });
                settings[`${category}CategoryImage`] = imageUrl;
            }

            await settings.save();
            
            // Prepare response with category images
            const categoryImages = {
                left: settings.leftCategoryImage,
                right: settings.rightCategoryImage,
                top: settings.topCategoryImage,
                bottom: settings.bottomCategoryImage
            };
            
            res.json({ 
                success: true, 
                categoryImages
            });
        });
    } catch (error) {
        console.error('Error updating category image:', error);
        res.status(500).json({ success: false, message: 'Failed to update category image' });
    }
};

export const updateCategoryAssignment = async (req, res) => {
    try {
        const { position, categoryId } = req.body;
        let settings = await HomeSettings.findOne();

        if (!settings) {
            settings = new HomeSettings();
        }

        // If categoryId is empty, remove the assignment
        if (!categoryId) {
            settings[`${position}Category`] = null;
            await settings.save();
            return res.json({ 
                success: true, 
                message: 'Category assignment removed successfully',
                categoryAssignments: {
                    left: settings.leftCategory,
                    right: settings.rightCategory,
                    top: settings.topCategory,
                    bottom: settings.bottomCategory
                }
            });
        }

        // Validate category exists
        const category = await Category.findById(categoryId);
        if (!category) {
            return res.status(404).json({ 
                success: false, 
                message: 'Category not found' 
            });
        }

        // Update the assignment
        settings[`${position}Category`] = {
            _id: category._id,
            name: category.name,
            description: category.description || ''
        };

        await settings.save();
        
        res.json({ 
            success: true, 
            message: 'Category assignment updated successfully',
            categoryAssignments: {
                left: settings.leftCategory,
                right: settings.rightCategory,
                top: settings.topCategory,
                bottom: settings.bottomCategory
            }
        });
    } catch (error) {
        console.error('Error updating category assignment:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update category assignment' 
        });
    }
};

export const updateHandpickedProduct = async (req, res) => {
    try {
        const { position, productId } = req.body;
        
        // Validate position
        if (!['left', 'middle', 'right'].includes(position)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid position. Must be left, middle, or right.'
            });
        }

        // Get or create home settings
        let homeSettings = await HomeSettings.findOne();
        if (!homeSettings) {
            homeSettings = new HomeSettings();
        }

        // Map position to field name
        const positionToField = {
            left: 'handpickedProduct1',
            middle: 'handpickedProduct2',
            right: 'handpickedProduct3'
        };

        const fieldName = positionToField[position];

        // If productId is null, clear the position
        if (!productId) {
            homeSettings[fieldName] = null;
            await homeSettings.save();
            return res.json({
                success: true,
                message: `Product removed from ${position} position`
            });
        }

        // Validate product ID format
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID format'
            });
        }

        // Check if product exists and is active
        const product = await Product.findOne({ _id: productId, status: 'Active' });
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found or inactive'
            });
        }

        // Update the specific position with correct field mapping
        homeSettings[fieldName] = {
            _id: product._id,
            name: product.name,
            imagePath: product.images && product.images.length > 0 ? product.images[0].path : null
        };

        await homeSettings.save();

        res.json({
            success: true,
            message: `Product updated in ${position} position`
        });
    } catch (error) {
        console.error('Error updating handpicked product:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update handpicked product'
        });
    }
};

export const updateHandpickedProducts = async (req, res) => {
    try {
        const { productIds, positions } = req.body;
        
        // Get or create home settings
        let homeSettings = await HomeSettings.findOne();
        if (!homeSettings) {
            homeSettings = new HomeSettings();
        }

        // If no product IDs provided, clear all handpicked products
        if (!productIds || productIds.length === 0) {
            homeSettings.handpickedProduct1 = null;
            homeSettings.handpickedProduct2 = null;
            homeSettings.handpickedProduct3 = null;
            await homeSettings.save();
            return res.json({
                success: true,
                message: 'All handpicked products cleared'
            });
        }

        // Validate product IDs format
        for (const id of productIds) {
            if (!mongoose.Types.ObjectId.isValid(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid product ID format'
                });
            }
        }

        // Fetch products to get their details
        const products = await Product.find({ 
            _id: { $in: productIds },
            isActive: true
        });

        // Check if all products exist and are active
        if (products.length !== productIds.length) {
            return res.status(404).json({
                success: false,
                message: 'One or more products not found or inactive'
            });
        }

        // Create a map of product IDs to product details
        const productMap = {};
        products.forEach(product => {
            productMap[product._id.toString()] = {
                productId: product._id,
                name: product.name,
                brand: product.brand,
                imagePath: product.imagePath
            };
        });

        // Clear existing handpicked products
        homeSettings.handpickedProduct1 = null;
        homeSettings.handpickedProduct2 = null;
        homeSettings.handpickedProduct3 = null;

        // If positions are provided, update each position separately
        if (positions && positions.length > 0) {
            positions.forEach((position, index) => {
                if (index < productIds.length) {
                    const productId = productIds[index];
                    const productDetails = productMap[productId];
                    
                    if (productDetails) {
                        switch(position) {
                            case 'left':
                                homeSettings.handpickedProduct1 = productDetails;
                                break;
                            case 'middle':
                                homeSettings.handpickedProduct2 = productDetails;
                                break;
                            case 'right':
                                homeSettings.handpickedProduct3 = productDetails;
                                break;
                        }
                    }
                }
            });
        } else {
            // Fallback to old behavior - assign products in order
            if (productIds.length > 0) {
                homeSettings.handpickedProduct1 = productMap[productIds[0]];
            }
            if (productIds.length > 1) {
                homeSettings.handpickedProduct2 = productMap[productIds[1]];
            }
            if (productIds.length > 2) {
                homeSettings.handpickedProduct3 = productMap[productIds[2]];
            }
        }

        await homeSettings.save();

        res.json({
            success: true,
            message: 'Handpicked products updated successfully'
        });
    } catch (error) {
        console.error('Error updating handpicked products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update handpicked products'
        });
    }
};