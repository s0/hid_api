'use strict';

const Controller = require('trails/controller');
const async = require('async');

/**
 * @module DuplicateController
 * @description Generated Trails.js Controller.
 */
module.exports = class DuplicateController extends Controller{
  // Find duplicates
  find (request, reply) {
    const Duplicate = this.app.orm.Duplicate;
    const options = this.app.services.HelperService.getOptionsFromQuery(request.query);
    const criteria = this.app.services.HelperService.getCriteriaFromQuery(request.query);

    const that = this;
    const query = this.app.services.HelperService.find('Duplicate', criteria, options);
    query
      .then((results) => {
        return Duplicate
          .count(criteria)
          .then((number) => {
            return {result: results, number: number};
          });
      })
      .then((result) => {
        return reply(result.result).header('X-Total-Count', result.number);
      })
      .catch((err) => {
        that.app.services.ErrorService.handle(err, reply);
      });
  }

  // Generate the duplicates
  generate (request, reply) {
    reply();
    const User = this.app.orm.User;
    const Duplicate = this.app.orm.Duplicate;
    this.app.log.info('Generating duplicates');
    const stream = User.find({}).stream();

    const app = this.app;
    stream.on('data', function(user) {
      this.pause();
      const that = this;
      app.log.info('Looking for duplicates of ' + user.email);
      if (user.emails && user.emails.length) {
        async.eachSeries(user.emails, function (email, callback) {
          User
            .find({'emails.email': email.email})
            .then(users => {
              if (users && users.length > 1) {
                const dup = {
                  user: user,
                  duplicates: users
                };
                Duplicate
                  .create(dup)
                  .then((duplicate) => {
                    callback();
                  });
              }
              else {
                callback();
              }
            });
        }, function (err) {
          that.resume();
        });
      }
      else {
        this.resume();
      }
    });
  }

  // Delete a duplicated user, and the duplicate associated
  delete (request, reply) {
    const User = this.app.orm.User;
    const Duplicate = this.app.orm.Duplicate;
    const that = this;
    User
      .remove({_id: request.params.id}, function (err) {
        Duplicate
          .findOne({duplicates: request.params.id})
          .then((dup) => {
            if (dup.duplicates.length === 2) {
              dup.remove();
            }
            reply();
          })
          .catch(err => {
            that.app.services.ErrorService.handle(err, reply);
          });
      });
  }
};