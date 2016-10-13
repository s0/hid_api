'use strict'

const Controller = require('trails-controller')
const Boom = require('boom')
const Bcrypt = require('bcryptjs')
const childAttributes = ['lists', 'organizations', 'operations', 'bundles', 'disasters']

/**
 * @module UserController
 * @description Generated Trails.js Controller.
 */
module.exports = class UserController extends Controller{

  create (request, reply) {
    const FootprintService = this.app.services.FootprintService
    const options = this.app.packs.hapi.getOptionsFromQuery(request.query)
    const Model = this.app.orm['user']

    this.log.debug('[UserController] (create) payload =', request.payload, 'options =', options)

    if (request.payload.password && request.payload.confirm_password) {
      request.payload.password = Model.hashPassword(request.payload.password);
    }

    var app_verify_url = request.payload.app_verify_url
    delete request.payload.app_verify_url

    var that = this
    Model.create(request.payload, function (err, user) {
      // TODO: do error handling
      if (user.email) {
        that.app.services.EmailService.sendRegister(user, app_verify_url, function (merr, info) {
          return reply(user);
        });
      }
      else {
        return reply(user);
      }
    });
  }

  find (request, reply) {
    const FootprintService = this.app.services.FootprintService
    const options = this.app.packs.hapi.getOptionsFromQuery(request.query)
    const criteria = this.app.packs.hapi.getCriteriaFromQuery(request.query)
    let response, count

    if (!options.populate) options.populate = "favoriteLists";

    // Hide unconfirmed users
    if (request.params.currentUser && !request.params.currentUser.is_admin) criteria['email_verified'] = true

    if (criteria['roles.id']) {
      criteria['roles.id'] = parseInt(criteria['roles.id']);
    }

    if (criteria['name']) {
      criteria['name'] = new RegExp(criteria['name'], "i")
    }

    if (criteria['country']) {
      criteria['location.country.id'] = criteria['country'];
      delete criteria['country'];
    }

    this.log.debug('[FootprintController] (find) model = user, criteria =', request.query, request.params.id,
      'options =', options)

    if (request.params.id) {
      response = FootprintService.find('user', request.params.id, options)
    }
    else {
      response = FootprintService.find('user', criteria, options)
    }
    count = FootprintService.count('user', criteria)

    count.then(number => {
      reply(
        response
          .then(result => {
            if (!result) return Boom.notFound()

            return result
          })
          .catch(function (err) { that.log.debug(err); })
        )
        .header('X-Total-Count', number)
    })
  }

  update (request, reply) {
    const FootprintService = this.app.services.FootprintService
    const options = this.app.packs.hapi.getOptionsFromQuery(request.query)
    const criteria = this.app.packs.hapi.getCriteriaFromQuery(request.query)
    const Model = this.app.orm['user']

    if (!options.populate) options.populate = "favoriteLists"

    this.log.debug('[UserController] (update) model = user, criteria =', request.query, request.params.id,
      ', values = ', request.payload)

    // Do not allow childAttributes to be updated through the update method
    for (var i = 0, len = childAttributes.length; i < len; i++) {
      if (request.payload[childAttributes[i]]) {
        delete request.payload[childAttributes[i]]
      }
    }

    if (request.params.id) {
      if (request.payload.old_password && request.payload.new_password) {
        // Check old password
        Model
          .findOne({_id: request.params.id})
          .then((user) => {
            if (user.validPassword(request.payload.old_password)) {
              request.payload.password = Model.hashPassword(request.payload.new_password)
              return reply(FootprintService.update('user', request.params.id, request.payload, options))
            }
            else {
              return reply(Boom.badRequest('The old password is wrong'))
            }
          });
      }
      else {
        reply(FootprintService.update('user', request.params.id, request.payload, options))
      }
    }
    else {
      reply(FootprintService.update('user', criteria, request.payload, options))
    }
  }

  destroy (request, reply) {
    const FootprintService = this.app.services.FootprintService
    const options = this.app.packs.hapi.getOptionsFromQuery(request.query)
    const criteria = this.app.packs.hapi.getCriteriaFromQuery(request.query)

    this.log.debug('[UserController] (destroy) model = user, query =', request.query)

    if (request.params.id) {
      FootprintService.destroy('listuser', {user: request.params.id}, options)
      reply(FootprintService.destroy('user', request.params.id, options))
    }
    else {
      reply(FootprintService.destroy('user', criteria, options))
    }
  }

  checkin (request, reply) {
    const options = this.app.packs.hapi.getOptionsFromQuery(request.query)
    const userId = request.params.id
    const childAttribute = request.params.childAttribute
    const payload = request.payload
    const Model = this.app.orm['user']
    const List = this.app.orm['list']

    this.log.debug('[UserController] (checkin) user ->', childAttribute, ', payload =', payload,
      'options =', options)

    if (childAttributes.indexOf(childAttribute) === -1)
      return reply(Boom.notFound())

    // Make sure there is a list in the payload
    if (!payload.list)
      return reply(Boom.badRequest('Missing list attribute'))

    List
      .findOne({ _id: payload.list })
      .then((list) => {
        // Check that the list added corresponds to the right attribute
        if (childAttribute != list.type + 's') 
          return reply(Boom.badRequest('Wrong list type'))
        
        //Set the proper pending attribute depending on list type
        if (list.joinability == 'public' || list.joinability == 'private')
          payload.pending = false

        Model
          .findOne({ _id: userId })
          .then((record) => {
            if (!record)
              return reply(Boom.notFound())

            if (!record[childAttribute])
              record[childAttribute] = []

            // Make sure user is not already checked in this list
            for (var i = 0, len = record[childAttribute].length; i < len; i++) {
              if (record[childAttribute][i].list.equals(list._id)) {
                return reply(Boom.badRequest('User is already checked in'));
              }
            }

            // TODO: make sure user is allowed to join this list

            record[childAttribute].push(payload)

            record.save().then(() => {
              return reply(record)
            })
        })
      })
  }

  checkout (request, reply) {
    const options = this.app.packs.hapi.getOptionsFromQuery(request.query)
    const userId = request.params.id
    const childAttribute = request.params.childAttribute
    const checkInId = request.params.checkInId
    const payload = request.payload
    const Model = this.app.orm['user']

    this.log.debug('[UserController] (checkout) user ->', childAttribute, ', payload =', payload,
      'options =', options)

    Model
      .findOne({ _id: userId })
      .then(record => {
        record[childAttribute].filter(function (elt, index) {
          return !checkInId.equals(elt._id);
        });

        record.save().then(() => {
          return reply(record)
        })
      })
  }

  verifyEmail (request, reply) {
    const userId = request.params.id
    const Model = this.app.orm['user']

    if (!request.payload.hash) return reply(Boom.badRequest('Missing hash parameter'))

    var that = this;
    Model
      .findOne({ _id: userId })
      .then(record => {
        // Verify hash
        var valid = record.validHash(request.payload.hash)
        if (valid === true) {
          // Verify user email
          record.email_verified = true
          record.save().then(() => {
            that.app.services.EmailService.sendPostRegister(record, function (merr, info) {
              return reply(record);
            });
          })
        }
        else {
          return reply(Boom.badRequest(valid))
        }
      })
  }

}

