import Category from '../../model/categoryModel.js';

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

        res.render('admin/category', responseData);

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

        const newCategory = new Category({
            name,
            description,
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
            message: 'Error adding category'
        });
    }
};

const updateCategoryStatus = async (req, res) => {
    try {
        const categoryId = req.params.id;
        const { status } = req.body;

        if (!["Active", "Inactive"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status value'
            });
        }

        const category = await Category.findByIdAndUpdate(
            categoryId,
            { status },
            { new: true }
        );

        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        res.json({
            success: true,
            message: `Category ${status === 'Active' ? 'activated' : 'deactivated'} successfully`,
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

export default { getCategories, addCategory, updateCategoryStatus };
