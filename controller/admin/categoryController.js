import Category from '../../model/categoryModel.js';
import Product from '../../model/productModel.js';

const getCategories = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const [totalCategories, categories] = await Promise.all([
            Category.countDocuments(),
            Category.find()
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
        ]);

        const totalPages = Math.ceil(totalCategories / limit);

        const responseData = {
            categories,
            pagination: {
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
                nextPage: page + 1,
                prevPage: page - 1
            }
        };

        res.render('admin/category.ejs', responseData);

    } catch (error) {
        console.error('Category List Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching categories'
        });
    }
};

const addCategory = async (req, res) => {
    try {
        const { name, description } = req.body;


        const trimmedName = name?.trim();
        const trimmedDescription = description?.trim();


        if (!trimmedName) {
            return res.status(400).json({
                success: false,
                message: 'Category name is required'
            });
        }

        if (trimmedName.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Category name must be at least 3 characters long'
            });
        }

        if (!trimmedDescription) {
            return res.status(400).json({
                success: false,
                message: 'Category description is required'
            });
        }

        if (trimmedDescription.length < 10) {
            return res.status(400).json({
                success: false,
                message: 'Category description must be at least 10 characters long'
            });
        }

        // To Check if category name already exists 
        const existingCategory = await Category.findOne({
            name: { $regex: new RegExp(`^${trimmedName}$`, 'i') }
        });

        if (existingCategory) {
            return res.status(400).json({
                success: false,
                message: 'Category name already exists'
            });
        }

        // Create new category
        const newCategory = new Category({
            name: trimmedName,
            description: trimmedDescription,
            status: 'Active'
        });

        await newCategory.save();

        res.json({
            success: true,
            message: 'Category added successfully',
            category: newCategory
        });

    } catch (error) {
        console.error('Add Category Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error adding category'
        });
    }
};

const updateCategoryStatus = async (req, res) => {
    try {
        const categoryId = req.params.id;
        const { status } = req.body;

        console.log('Updating category status:', { categoryId, status }); // Debug log

        if (!["Active", "Inactive"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status value'
            });
        }

        // First find the category
        const category = await Category.findById(categoryId);

        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        // Update category status
        category.status = status;
        await category.save();

        // If deactivating, also deactivate all products in this category
        if (status === 'Inactive') {
            try {
                const result = await Product.updateMany(
                    { category: categoryId },
                    { $set: { status: 'Inactive' } }
                );
                console.log('Products updated:', result); // Debug log
            } catch (error) {
                console.error('Error updating products:', error);
            }
        }

        res.json({
            success: true,
            message: `Category ${status === 'Active' ? 'activated' : 'deactivated'} successfully. ${
                status === 'Inactive' ? 'All associated products have been deactivated.' : ''
            }`,
            category
        });

    } catch (error) {
        console.error('Update Category Status Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating category status'
        });
    }
};

const updateCategory = async (req, res) => {
    try {
        const categoryId = req.params.id;
        const { name, description } = req.body;

        const trimmedName = name?.trim();
        const trimmedDescription = description?.trim();

        // Validation
        if (!trimmedName) {
            return res.status(400).json({
                success: false,
                message: 'Category name is required'
            });
        }

        if (trimmedName.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Category name must be at least 3 characters long'
            });
        }

        if (!trimmedDescription) {
            return res.status(400).json({
                success: false,
                message: 'Category description is required'
            });
        }

        if (trimmedDescription.length < 10) {
            return res.status(400).json({
                success: false,
                message: 'Category description must be at least 10 characters long'
            });
        }

        // Check if the new name already exists (excluding the current category)
        const existingCategory = await Category.findOne({
            _id: { $ne: categoryId },
            name: { $regex: new RegExp(`^${trimmedName}$`, 'i') }
        });

        if (existingCategory) {
            return res.status(400).json({
                success: false,
                message: 'Category name already exists'
            });
        }

        // Update the category
        const updatedCategory = await Category.findByIdAndUpdate(
            categoryId,
            {
                name: trimmedName,
                description: trimmedDescription
            },
            { new: true }
        );

        if (!updatedCategory) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        res.json({
            success: true,
            message: 'Category updated successfully',
            category: updatedCategory
        });

    } catch (error) {
        console.error('Update Category Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error updating category'
        });
    }
};

export default { getCategories, addCategory, updateCategoryStatus, updateCategory };
