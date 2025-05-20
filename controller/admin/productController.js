import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'public/uploads/products';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const mimetype = allowedTypes.test(file.mimetype);
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
        return cb(null, true);
    }
    cb(new Error('Only image files (jpeg, jpg, png, webp) are allowed!'));
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 5 
    },
    fileFilter: fileFilter
}).array('images', 5);

const getProducts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const [totalProducts, products, categories] = await Promise.all([
            Product.countDocuments(),
            Product.find()
                .populate('category', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Category.find({ status: 'Active' })
        ]);

        const totalPages = Math.ceil(totalProducts / limit);

        res.render('admin/product.ejs', {
            products,
            categories,
            pagination: {
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
                nextPage: page + 1,
                prevPage: page - 1
            }
        });

    } catch (error) {
        console.error('Product List Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching products'
        });
    }
};

const addProduct = async (req, res) => {
    try {
        upload(req, res, async (err) => {
            if (err) {
                return res.status(400).json({
                    success: false,
                    message: err.message
                });
            }

            try {
                const name = req.body.name?.[0] || req.body.name;
                const description = req.body.description?.[0] || req.body.description;
                const brand = req.body.brand?.[0] || req.body.brand;
                const color = req.body.color?.[0] || req.body.color;
                const category = req.body.category?.[0] || req.body.category;
                const discount = parseInt(req.body.discount?.[0] || req.body.discount || '0');

                // Parse variants
                let variants = [];
                if (req.body.variants) {
                    variants = JSON.parse(Array.isArray(req.body.variants) ? 
                        req.body.variants[0] : req.body.variants);
                }

                // Process images
                const images = req.files.map((file, index) => ({
                    path: '/uploads/products/' + file.filename,
                    filename: file.filename,
                    order: req.body.imageOrder?.[index] || index
                }));

                // Create new product with color field
                const newProduct = new Product({
                    name,
                    description,
                    brand,
                    color,
                    category,
                    discount,
                    images,
                    variants,
                    status: 'Active'
                });

                // Validate both variants are filled
                variants.forEach(variant => {
                    if (!variant.price || variant.stock === undefined) {
                        throw new Error(`Please fill in all required fields for ${variant.type} variant`);
                    }
                    if(variant.specifications.length === 0){
                        throw new Error("Please add specifications for all variants")
                    }
                 
                });

                await newProduct.save();

                res.json({
                    success: true,
                    message: 'Product added successfully',
                    product: newProduct
                });
            } catch (error) {
              
                if (req.files) {
                    req.files.forEach(file => {
                        fs.unlink(file.path, err => {
                            if (err) console.error('Error deleting file:', err);
                        });
                    });
                }

                console.error('Add Product Error:', error);
                res.status(500).json({
                    success: false,
                    message: error.message || 'Error adding product'
                });
            }
        });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing upload'
        });
    }
};

const updateProduct = async (req, res) => {
    try {
        upload(req, res, async (err) => {
            if (err) {
                return res.status(400).json({
                    success: false,
                    message: err.message
                });
            }

            try {
                const productId = req.params.id;
                const product = await Product.findById(productId);

                if (!product) {
                    return res.status(404).json({
                        success: false,
                        message: 'Product not found'
                    });
                }

                // Get form data including color
                const name = req.body.name?.[0] || req.body.name;
                const description = req.body.description?.[0] || req.body.description;
                const brand = req.body.brand?.[0] || req.body.brand;
                const color = req.body.color?.[0] || req.body.color;
                const category = req.body.category?.[0] || req.body.category;
                const discount = parseInt(req.body.discount?.[0] || req.body.discount || '0');

                // Handle variants
                let variants = [];
                if (req.body.variants) {
                    const variantsData = Array.isArray(req.body.variants) ? 
                        req.body.variants[0] : req.body.variants;
                    variants = JSON.parse(variantsData);

                    // Check if any variant has zero stock
                    // const hasZeroStock = variants.some(variant => variant.stock === 0);
                    // if (hasZeroStock) {
                    //     return res.status(400).json({
                    //         success: false,
                    //         message: 'Cannot update product with zero stock. Please set a stock value greater than 0.'
                    //     });
                    // }
                }

                // Handle images
                let images = [...product.images]; // Start with existing images

                // Remove images that are no longer present
                if (req.body.existingImages) {
                    const existingImages = JSON.parse(
                        Array.isArray(req.body.existingImages) ? 
                        req.body.existingImages[0] : req.body.existingImages
                    );
                    
                    // Delete removed images from storage
                    const removedImages = images.filter(img => 
                        !existingImages.some(existing => existing.filename === img.filename)
                    );
                    
                    for (const img of removedImages) {
                        const filePath = 'public' + img.path;
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    }

                    images = existingImages;
                }

                // Add new images
                if (req.files && req.files.length > 0) {
                    const newImages = req.files.map(file => ({
                        path: '/uploads/products/' + file.filename,
                        filename: file.filename
                    }));
                    images = [...images, ...newImages];
                }

                // Update product with color field
                const updatedProduct = await Product.findByIdAndUpdate(
                    productId,
                    {
                        name,
                        description,
                        brand,
                        color,
                        category,
                        discount,
                        images,
                        variants
                    },
                    { new: true, runValidators: true }
                );

                res.json({
                    success: true,
                    message: 'Product updated successfully',
                    product: updatedProduct
                });

            } catch (error) {
 
                if (req.files) {
                    req.files.forEach(file => {
                        const filePath = 'public/uploads/products/' + file.filename;
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    });
                }

                console.error('Update Product Error:', error);
                res.status(500).json({
                    success: false,
                    message: error.message || 'Error updating product'
                });
            }
        });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing upload'
        });
    }
};

const toggleProductStatus = async (req, res) => {
    try {
        const productId = req.params.id;
        
        const product = await Product.findById(productId);
        
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        // Toggle the status
        const newStatus = product.status === 'Active' ? 'Inactive' : 'Active';
        
        const updatedProduct = await Product.findByIdAndUpdate(
            productId,
            { status: newStatus },
            { new: true }
        );

        res.json({
            success: true,
            message: `Product ${newStatus === 'Active' ? 'activated' : 'deactivated'} successfully`,
            status: newStatus
        });

    } catch (error) {
        console.error('Toggle Product Status Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating product status'
        });
    }
};

export default {
    getProducts,
    addProduct,
    updateProduct,
    toggleProductStatus,
    upload
};
