// Define global variables for JSHint
/*global angular*/


(function () {
    'use strict';

    angular.module('myApp').directive('pcMsgContainer', function () {
        var historyTemplate = '<textarea id="_history" class="pc-history" rows="4" ng-style="highlightStyle" ng-show="isExpanded" ng-click="click($event)" readonly="readonly" type="text" ng-model="history"></textarea>';
        var inputTemplate = '<textarea id="_input" class="pc-input" rows="2" placeholder="Enter message" ng-show="isExpanded" type="text" ng-model="text" ng-click="click($event)" ui-keypress="{enter: \'_send(peer,$event)\'}"></textarea>';

        return {
            restrict: 'E',
            compile: function (tElement /*, tAttrs, transclude*/) {
                //var historyElement = angular.element(historyTemplate);
                var inputElement = angular.element(inputTemplate);
                tElement.html(historyTemplate);
                tElement.append(inputElement);

                return function (scope, element /*, attrs*/) {
                    scope.$watch('history', function (/*newval, oldval*/) {
                        element.find('#_history').scrollTop(9999);
                    });

                    scope._send = function (peer, event) {
                        scope.send(peer);
                        element.find('#_history').scrollTop(9999);
                        event.preventDefault();
                    };

                    scope.click = function (event) {
                        event.stopPropagation();
                    };
                };
            }
        };
    });

}());