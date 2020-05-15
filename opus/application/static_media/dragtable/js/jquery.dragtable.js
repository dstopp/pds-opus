/* jshint esversion: 6 */
/* jshint bitwise: true, curly: true, freeze: true, futurehostile: true */
/* jshint latedef: true, leanswitch: true, noarg: true, nocomma: true */
/* jshint nonbsp: true, nonew: true */
/* jshint varstmt: true */
/*!
 * dragtable
 *
 * @Based on akottr.dragtable Version 2.0.15
 *
 */

(function($) {
    /** closure-scoped "private" functions **/
    let body_onselectstart_save = $(document.body).attr("onselectstart");
    let body_unselectable_save = $(document.body).attr("unselectable");

    // css properties to disable user-select on the body tag by appending a <style> tag to the <head>
    // remove any current document selections

    function disableTextSelection() {
        // jQuery doesn't support the element.text attribute in MSIE 8
        // http://stackoverflow.com/questions/2692770/style-style-textcss-appendtohead-does-not-work-in-ie
        let $style = $('<style id="__dragtable_disable_text_selection__" type="text/css">body { -ms-user-select:none;-moz-user-select:-moz-none;-khtml-user-select:none;-webkit-user-select:none;user-select:none; }</style>');
        $(document.head).append($style);
        $(document.body).attr("onselectstart", "return false;").attr("unselectable", "on");
        if (window.getSelection) {
            window.getSelection().removeAllRanges();
        } else {
            document.selection.empty(); // MSIE http://msdn.microsoft.com/en-us/library/ms535869%28v=VS.85%29.aspx
        }
    }

    // remove the <style> tag, and restore the original <body> onselectstart attribute

    function restoreTextSelection() {
        $("#__dragtable_disable_text_selection__").remove();
        if (body_onselectstart_save) {
            $(document.body).attr("onselectstart", body_onselectstart_save);
        } else {
            $(document.body).removeAttr("onselectstart");
        }
        if (body_unselectable_save) {
            $(document.body).attr("unselectable", body_unselectable_save);
        } else {
            $(document.body).removeAttr("unselectable");
        }
    }

    function swapNodes(a, b) {
        let aparent = a.parentNode;
        let asibling = a.nextSibling === b ? a : a.nextSibling;
        b.parentNode.insertBefore(a, b);
        aparent.insertBefore(b, asibling);
    }

    $.widget("opus.dragtable", {
        options: {
            dragHandle: "",              // handle for moving cols, if not exists the whole 'th' is the handle
            maxMovingRows: 40,           // 1 -> only header. 40 row should be enough, the rest is usually not in the viewport
            excludeFooter: false,        // excludes the footer row(s) while moving other columns. Make sense if there is a footer with a colspan. */
            dragaccept: null,            // draggable cols -> default all
            axis: false,                 // @see https://api.jqueryui.com/sortable/#option-axis
            classes: {},                 // @see https://api.jqueryui.com/sortable/#option-classes
            containment: false,          // @see https://api.jqueryui.com/sortable/#option-containment
            cursor: "auto",              // @see https://api.jqueryui.com/sortable/#option-cursor
            cursorAt: false,             // @see https://api.jqueryui.com/sortable/#option-cursorAt
            helper: "original",          // @see https://api.jqueryui.com/sortable/#option-helper
            items: "> *",                // @see https://api.jqueryui.com/sortable/#option-items
            opacity: false,              // @see https://api.jqueryui.com/sortable/#option-opacity
            revert: false,               // @see https://api.jqueryui.com/sortable/#option-revert
            tolerance: 'pointer',        // @see https://api.jqueryui.com/sortable/#option-tolerance
            zIndex: 1000,                // @see https://api.jqueryui.com/sortable/#option-zIndex
            exact: true,                 // removes pixels, so that the overlay table width fits exactly the original table width
            clickDelay: 10,              // ms to wait before rendering sortable list and delegating click event
            beforeStart: $.noop,         // returning FALSE will stop the execution chain.
            beforeMoving: $.noop,
            beforeReorganize: $.noop,
            beforeStop: $.noop
        },

        originalTable: {
            el: null,
            selectedHandle: null,
            sortOrder: null,
            startIndex: 0,
            endIndex: 0
        },

        sortableTable: {
            el: $(),
            selectedHandle: $(),
            movingRow: $()
        },

        // bubble the moved col left or right
        _bubbleCols: function() {
            let from = this.originalTable.startIndex;
            let to = this.originalTable.endIndex;
            /* Find children thead and tbody.
             * Only to process the immediate tr-children. Bugfix for inner tables
             */
            let thtb =  this.originalTable.el.children();
            if (this.options.excludeFooter) {
                 thtb = thtb.not("tfoot");
            }

            if (from < to) {
                for (let i = from; i < to; i++) {
                    let col1 = thtb.find(`> tr > td:nth-child(${i})`)
                                    .add(thtb.find(`> tr > th:nth-child(${i})`));
                    let col2 = thtb.find(`> tr > td:nth-child(${(i + 1)})`)
                                    .add(thtb.find(`> tr > th:nth-child(${(i + 1)})`));
                    for (let j = 0; j < col1.length; j++) {
                        swapNodes(col1[j], col2[j]);
                    }
                }
            } else {
                for (let i = from; i > to; i--) {
                    let col1 = thtb.find(`> tr > td:nth-child(${i})`)
                                    .add(thtb.find(`> tr > th:nth-child(${i})`));
                    let col2 = thtb.find(`> tr > td:nth-child(${(i - 1)})`)
                                    .add(thtb.find(`> tr > th:nth-child(${(i - 1)})`));
                    for (let j = 0; j < col1.length; j++) {
                        swapNodes(col1[j], col2[j]);
                    }
                }
            }
        },
        _rearrangeTableBackroundProcessing: function() {
            let _this = this;
            return function() {
                _this._bubbleCols();
                _this.options.beforeStop(_this.originalTable);
                _this.sortableTable.el.remove();
                restoreTextSelection();
            };
        },
        _rearrangeTable: function() {
            let _this = this;
            return function() {
                // remove handler-class -> handler is now finished
                _this.originalTable.selectedHandle.removeClass('dragtable-handle-selected');
                // add disabled class -> reorgorganisation starts soon
                _this.sortableTable.el.sortable("disable");
                _this.sortableTable.el.addClass('dragtable-disabled');
                _this.options.beforeReorganize(_this.originalTable, _this.sortableTable);
                // do reorganisation asynchronous
                // for chrome a little bit more than 1 ms because we want to force a rerender
                _this.originalTable.endIndex = _this.sortableTable.movingRow.prevAll().length + 1;
                setTimeout(_this._rearrangeTableBackroundProcessing(), 50);
            };
        },
        /*
         * Disrupts the table. The original table stays the same.
         * But on a layer above the original table we are constructing a list (ul > li)
         * each li with a separate table representig a single col of the original table.
         */
         _generateSortable: function(e) {
              //!e.cancelBubble && (e.cancelBubble = true);
              let _this = this;
              // table attributes
              let attrs = this.originalTable.el[0].attributes;
              let attrsString = "";
              for (let i = 0; i < attrs.length; i++) {
                  if (attrs[i].nodeValue && attrs[i].nodeName != "id" && attrs[i].nodeName != "width") {
                      attrsString += `${attrs[i].nodeName}="${attrs[i].nodeValue}" `;
                  }
              }

              // row attributes
              let rowAttrsArr = [];
              //compute height, special handling for ie needed :-(
              let heightArr = [];
              this.originalTable.el.find("tr").slice(0, this.options.maxMovingRows).each(function(i, v) {
                  // row attributes
                  let attrs = this.attributes;
                  let attrsString = "";
                  for (let j = 0; j < attrs.length; j++) {
                      if (attrs[j].nodeValue && attrs[j].nodeName != "id") {
                          attrsString += ` ${attrs[j].nodeName}="${attrs[j].nodeValue}"`;
                      }
                  }
                  rowAttrsArr.push(attrsString);
                  heightArr.push($(this).height());
              });

              let thtb = _this.originalTable.el.children();
              if (this.options.excludeFooter) {
                  thtb = thtb.not("tfoot");
              }
              let widthArr = [];
              let tableWidth = this.originalTable.el.width();

              let sortableHtml = `<ul class="dragtable-sortable" style="position:absolute; width:${tableWidth}px;">`;
              // assemble the needed html
              thtb.find("> tr > th").each(function(i, v) {
                  let width_li = $(this).is(":visible") ? $(this).outerWidth() : 0;
                  widthArr[i] = width_li;
                  sortableHtml += `<li style="width:${width_li}px;">`;
                  sortableHtml += `<table ${attrsString}>`;
                  let row = thtb.find(`> tr > th:nth-child(${(i + 1)})`);
                  if (_this.options.maxMovingRows > 1) {
                      row = row.add(thtb.find(`> tr > td:nth-child(${(i + 1)})`).slice(0, _this.options.maxMovingRows - 1));
                  }
                  row.each(function(j) {
                      // TODO: May cause duplicate style-Attribute
                      let row_content = $(this).clone().wrap("<div></div>").parent().html();
                      let isHeader = (row_content.toLowerCase().indexOf("<th") === 0);
                      if (isHeader) {
                          sortableHtml += "<thead>";
                      }
                      sortableHtml += `<tr ${rowAttrsArr[j]} style="height:${heightArr[j]}px;">`;
                      sortableHtml += row_content;
                      console.log(`${j}: ${row_content}`);
                      sortableHtml += "</tr>";
                      if (isHeader) {
                          sortableHtml += "</thead>";
                      }
                  });
                  sortableHtml += "</table>";
                  sortableHtml += "</li>";
              });
              sortableHtml += "</ul>";
              this.sortableTable.el = this.originalTable.el.before(sortableHtml).prev();
              // set width if necessary
              this.sortableTable.el.find("> li > table").each(function(i, v) {
                  $(this).css("width", widthArr[i] + "px");
              });

              // assign this.sortableTable.selectedHandle
              this.sortableTable.selectedHandle = this.sortableTable.el.find("th .dragtable-handle-selected");

              let items = !this.options.dragaccept ? "li" : `li:has(${this.options.dragaccept})`;
              this.sortableTable.el.sortable({
                  items: items,
                  stop: this._rearrangeTable(),
                  // pass thru options for sortable widget
                  revert: this.options.revert,
                  tolerance: this.options.tolerance,
                  containment: this.options.containment,
                  cursor: this.options.cursor,
                  cursorAt: this.options.cursorAt,
                  axis: this.options.axis,
                  change: function(e, ui) {
                      let slug = ui.item.attr("id");
                      let td = $("tbody tr").find(`[data-slug="${slug}"]`);
                      return ui;
                  },
              });

              // assign start index
              this.originalTable.startIndex = $(e.target).closest("th").prevAll().length + 1;

              this.options.beforeMoving(this.originalTable, this.sortableTable);
              // Start moving by delegating the original event to the new sortable table
              this.sortableTable.movingRow = this.sortableTable.el.find(`> li:nth-child(${this.originalTable.startIndex})`);

              // prevent the user from drag selecting "highlighting" surrounding page elements
              disableTextSelection();
              // clone the initial event and trigger the sort with it
              let screenInfo = (e.type === "mousedown" ? e : e.touches[0]);
              this.sortableTable.movingRow.trigger($.extend($.Event("mousedown"), {
                  which: 1,
                  clientX: screenInfo.clientX,
                  clientY: screenInfo.clientY,
                  pageX: screenInfo.pageX,
                  pageY: screenInfo.pageY,
                  screenX: screenInfo.screenX,
                  screenY: screenInfo.screenY
              }));

              // Some inner divs to deliver the posibillity to style the placeholder more sophisticated
              let placeholder = this.sortableTable.el.find(".ui-sortable-placeholder");
              if (placeholder.height() > 0) {
                  placeholder.css("height", this.sortableTable.el.find(".ui-sortable-helper").height());
              }

              placeholder.html('<div class="outer" style="height:100%;"><div class="inner" style="height:100%;"></div></div>');
          },

          bindTo: {},

          _create: function() {
              this.originalTable = {
                  el: this.element,
                  selectedHandle: $(),
                  sortOrder: {},
                  startIndex: 0,
                  endIndex: 0
              };
              // bind draggable to 'th' by default
              this.bindTo = this.originalTable.el.find("th");
              // filter only the cols that are accepted
              if (this.options.dragaccept) {
                  this.bindTo = this.bindTo.filter(this.options.dragaccept);
              }
              // bind draggable to handle if exists
              if (this.bindTo.find(this.options.dragHandle).length > 0) {
                  this.bindTo = this.bindTo.find(this.options.dragHandle);
              }
              let _this = this;
              this.bindTo.on("mousedown touchstart touchmove", function(evt) {
                  evt.preventDefault();
                  // listen only to left mouse click
                  if (evt.type === "mousedown" && evt.which!==1 ||
                      _this.options.beforeStart(_this.originalTable) === false) {
                      return;
                  }
                  clearTimeout(this.downTimer);
                  this.downTimer = setTimeout(function() {
                      _this.originalTable.selectedHandle = $(this);
                      _this.originalTable.selectedHandle.addClass("dragtable-handle-selected");
                      _this._generateSortable(evt);
                  }, _this.options.clickDelay);
              }).on("mouseup touchend", function(evt) {
                  clearTimeout(this.downTimer);
              });
          },

          redraw: function() {
              this.destroy();
              this._create();
          },

          destroy: function() {
              this.bindTo.unbind("mousedown touchend");
              $.Widget.prototype.destroy.apply(this, arguments); // default destroy
              // now do other stuff particular to this widget
          }
    });
})(jQuery);
