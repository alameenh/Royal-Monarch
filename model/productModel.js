import mongoose from 'mongoose';

// Define a variant option schema for better organization
const variantOptionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Full option', 'Base'],
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  stock: {
    type: Number,
    required: true,
    min: 0
  },
  discount: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  specifications: [String]
});

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  brand: {
    type: String,
    required: true,
    trim: true
  },
    soldcount: {
    type: Number,
    default: 0
  },
  color: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },
  images: [{
    path: String,
    filename: String,
    order: Number
  }],
  variants: [variantOptionSchema],
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active'
  }
}, { timestamps: true });

export default mongoose.model('Product', productSchema);