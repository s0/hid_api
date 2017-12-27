'use strict';

const Model = require('trails/lib/Model');
const Schema = require('mongoose').Schema;

/**
 * @module GSSSync
 * @description Google Spreadsheet Sync
 */
module.exports = class GSSSync extends Model {

  static config () {
    return {
      schema: {
        timestamps: true
      },
      onSchema(app, schema) {
        schema.index({list: 1, spreadsheet: 1}, { unique: true});
      }
    };
  }

  static schema () {
    return {
      list: {
        type: Schema.ObjectId,
        ref: 'List',
        required: [true, 'A list is required']
      },
      spreadsheet: {
        type: String,
        required: [true, 'A spreadsheet ID is required']
      },
      user: {
        type: Schema.ObjectId,
        ref: 'User'
      }
    };
  }
};
