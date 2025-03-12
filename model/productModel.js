// import mongoose from 'mongoose';


// const variantSchema = new mongoose.Schema({
   
//   options: {
//       type: String,
//       enum: ['Full option', 'Base',],
//       required: true
//   },
//   stock: {
//       type: Number,
//       required: true,
//       default: 0
//   },
//   specifications: [{
//     type: String,
//     trim: true
//   }],
//   price: {
//     type: Number,
//     required: true,
//     min: 0
//   },
// });


// const productSchema = new mongoose.Schema({
//   name: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   description: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   brand: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   category: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'Category',
//     required: true
//   },
//   discount:{
//     type: Number,
//     default: 0,
//     min: 0,
//     max: 100
//   },
//   images: [{
//     path: String,
//     filename: String
//   }],
//   varient: [variantSchema],
//   status: {
//     type: String,
//     enum: ['Active', 'Inactive'],
//     default: 'Active'
//   }
// }, { timestamps: true });

// export default mongoose.model('Product', productSchema);