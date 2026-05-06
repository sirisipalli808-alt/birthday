(function () {
    
    var codeGenerator = (typeof eval("(function () {})") == "function") ?
        function (code) { return code; } :
        function (code) { return "false || " + code; };
        
    // support string type only.
    var stringify = (typeof JSON !== "undefined" && JSON.stringify) ?
        function (s) { return JSON.stringify(s); } :
        (function () {
            // Implementation comes from JSON2 (http://www.json.org/js.html)
        
            var escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
            
            var meta = {    // table of character substitutions
                '\b': '\\b',
                '\t': '\\t',
                '\n': '\\n',
                '\f': '\\f',
                '\r': '\\r',
                '"' : '\\"',
                '\\': '\\\\'
            }
            
            return function (s) {
                // If the string contains no control characters, no quote characters, and no
                // backslash characters, then we can safely slap some quotes around it.
                // Otherwise we must also replace the offending characters with safe escape
                // sequences.

                escapable.lastIndex = 0;
                return escapable.test(s) ? '"' + s.replace(escapable, function (a) {
                    var c = meta[a];
                    return typeof c === 'string' ? c :
                        '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
                }) + '"' : '"' + s + '"';
            };
        })();
    
    // seed defined in global
    if (typeof __jscex__tempVarSeed === "undefined") {
        __jscex__tempVarSeed = 0;
    }

    var init = function (root) {
    
        if (root.modules["jit"]) {
            return;
        }
    
        function JscexTreeGenerator(binder) {
            this._binder = binder;
            this._root = null;
        }
        JscexTreeGenerator.prototype = {

            generate: function (ast) {

                var params = ast[2], statements = ast[3];

                this._root = { type: "delay", stmts: [] };

                this._visitStatements(statements, this._root.stmts);

                return this._root;
            },

            _getBindInfo: function (stmt) {

                var type = stmt[0];
                if (type == "stat") {
                    var expr = stmt[1];
                    if (expr[0] == "call") {
                        var callee = expr[1];
                        if (callee[0] == "name" && callee[1] == this._binder && expr[2].length == 1) {
                            return {
                                expression: expr[2][0],
                                argName: "",
                                assignee: null
                            };
                        }
                    } else if (expr[0] == "assign") {
                        var assignee = expr[2];
                        expr = expr[3];
                        if (expr[0] == "call") {
                            var callee = expr[1];
                            if (callee[0] == "name" && callee[1] == this._binder && expr[2].length == 1) {
                                return {
                                    expression: expr[2][0],
                                    argName: "$$_result_$$",
                                    assignee: assignee
                                };
                            }
                        }
                    }
                } else if (type == "var") {
                    var defs = stmt[1];
                    if (defs.length == 1) {
                        var item = defs[0];
                        var name = item[0];
                        var expr = item[1];
                        if (expr && expr[0] == "call") {
                            var callee = expr[1];
                            if (callee[0] == "name" && callee[1] == this._binder && expr[2].length == 1) {
                                return {
                                    expression: expr[2][0],
                                    argName: name,
                                    assignee: null
                                };                            
                            }
                        }
                    }
                } else if (type == "return") {
                    var expr = stmt[1];
                    if (expr && expr[0] == "call") {
                        var callee = expr[1];
                        if (callee[0] == "name" && callee[1] == this._binder && expr[2].length == 1) {
                            return {
                                expression: expr[2][0],
                                argName: "$$_result_$$",
                                assignee: "return"
                            };
                        }
                    }
                }

                return null;
            },

            _visitStatements: function (statements, stmts, index) {
                if (arguments.length <= 2) index = 0;

                if (index >= statements.length) {
                    stmts.push({ type: "normal" });
                    return this;
                }

                var currStmt = statements[index];
                var bindInfo = this._getBindInfo(currStmt);

                if (bindInfo) {
                    var bindStmt = { type: "bind", info: bindInfo };
                    stmts.push(bindStmt);

                    if (bindInfo.assignee != "return") {
                        bindStmt.stmts = [];
                        this._visitStatements(statements, bindStmt.stmts, index + 1);
                    }

                } else {
                    var type = currStmt[0];
                    if (type == "return" || type == "break" || type == "continue" || type == "throw") {

                        stmts.push({ type: type, stmt: currStmt });

                    } else if (type == "if" || type == "try" || type == "for" || type == "do"
                               || type == "while" || type == "switch" || type == "for-in") {

                        var newStmt = this._visit(currStmt);

                        if (newStmt.type == "raw") {
                            stmts.push(newStmt);
                            this._visitStatements(statements, stmts, index + 1);
                        } else {
                            var isLast = (index == statements.length - 1);
                            if (isLast) {
                                stmts.push(newStmt);
                            } else {

                                var combineStmt = {
                                    type: "combine",
                                    first: { type: "delay", stmts: [newStmt] },
                                    second: { type: "delay", stmts: [] }
                                };
                                stmts.push(combineStmt);

                                this._visitStatements(statements, combineStmt.second.stmts, index + 1);
                            }
                        }

                    } else {

                        stmts.push({ type: "raw", stmt: currStmt });

                        this._visitStatements(statements, stmts, index + 1);
                    }
                }

                return this;
            },

            _visit: function (ast) {

                var type = ast[0];

                function throwUnsupportedError() {
                    throw new Error('"' + type + '" is not currently supported.');
                }

                var visitor = this._visitors[type];

                if (visitor) {
                    return visitor.call(this, ast);
                } else {
                    throwUnsupportedError();
                }
            },

            _visitBody: function (ast, stmts) {
                if (ast[0] == "block") {
                    this._visitStatements(ast[1], stmts);
                } else {
                    this._visitStatements([ast], stmts);
                }
            },

            _noBinding: function (stmts) {
                switch (stmts[stmts.length - 1].type) {
                    case "normal":
                    case "return":
                    case "break":
                    case "throw":
                    case "continue":
                        return true;
                }

                return false;
            },

            _collectCaseStatements: function (cases, index) {
                var res = [];

                for (var i = index; i < cases.length; i++) {
                    var rawStmts = cases[i][1];
                    for (var j = 0; j < rawStmts.length; j++) {
                        if (rawStmts[j][0] == "break") {
                            return res
                        }

                        res.push(rawStmts[j]);
                    }
                }

                return res;
            },

            _visitors: {

                "for": function (ast) {

                    var bodyStmts = [];
                    var body = ast[4];
                    this._visitBody(body, bodyStmts);

                    if (this._noBinding(bodyStmts)) {
                        return { type: "raw", stmt: ast };
                    }

                    var delayStmt = { type: "delay", stmts: [] };
            
                    var setup = ast[1];
                    if (setup) {
                        delayStmt.stmts.push({ type: "raw", stmt: setup });
                    }

                    var loopStmt = { type: "loop", bodyFirst: false, bodyStmt: { type: "delay", stmts: bodyStmts } };
                    delayStmt.stmts.push(loopStmt);
                    
                    var condition = ast[2];
                    if (condition) {
                        loopStmt.condition = condition;
                    }
                    
                    var update = ast[3];
                    if (update) {
                        loopStmt.update = update;
                    }

                    return delayStmt;
                },

                "for-in": function (ast) {

                    var body = ast[4];
                    
                    var bodyStmts = [];
                    this._visitBody(body, bodyStmts);

                    if (this._noBinding(bodyStmts)) {
                        return { type: "raw", stmt: ast };
                    }
                
                    var id = (__jscex__tempVarSeed++);
                    var keysVar = "$$_keys_$$_" + id;
                    var indexVar = "$$_index_$$_" + id;
                    // var memVar = "$$_mem_$$_" + id;

                    var delayStmt = { type: "delay", stmts: [] };

                    // var members = Jscex._forInKeys(obj);
                    var keysAst = root.parse("var " + keysVar + " = Jscex._forInKeys(obj);")[1][0];
                    keysAst[1][0][1][2][0] = ast[3]; // replace obj with real AST;
                    delayStmt.stmts.push({ type: "raw", stmt: keysAst });

                    /*
                    // var members = [];
                    delayStmt.stmts.push({
                        type: "raw",
                        stmt: uglifyJS.parse("var " + membersVar + " = [];")[1][0]
                    });
                    
                    // for (var mem in obj) members.push(mem);
                    var keysAst = uglifyJS.parse("for (var " + memVar +" in obj) " + membersVar + ".push(" + memVar + ");")[1][0];
                    keysAst[3] = ast[3]; // replace the "obj" with real AST.
                    delayStmt.stmts.push({ type : "raw", stmt: keysAst});
                    */
                    
                    // var index = 0;
                    delayStmt.stmts.push({
                        type: "raw",
                        stmt: root.parse("var " + indexVar + " = 0;")[1][0]
                    });

                    // index < members.length
                    var condition = root.parse(indexVar + " < " + keysVar + ".length")[1][0][1];

                    // index++
                    var update = root.parse(indexVar + "++")[1][0][1];

                    var loopStmt = {
                        type: "loop",
                        bodyFirst: false,
                        update: update,
                        condition: condition,
                        bodyStmt: { type: "delay", stmts: [] }
                    };
                    delayStmt.stmts.push(loopStmt);

                    var varName = ast[2][1]; // ast[2] == ["name", m]
                    if (ast[1][0] == "var") {
                        loopStmt.bodyStmt.stmts.push({
                            type: "raw",
                            stmt: root.parse("var " + varName + " = " + keysVar + "[" + indexVar + "];")[1][0]
                        });
                    } else {
                        loopStmt.bodyStmt.stmts.push({
                            type: "raw",
                            stmt: root.parse(varName + " = " + keysVar + "[" + indexVar + "];")[1][0]
                        });
                    }

                    this._visitBody(body, loopStmt.bodyStmt.stmts);

                    return delayStmt;
                },

                "while": function (ast) {

                    var bodyStmts = [];
                    var body = ast[2];
                    this._visitBody(body, bodyStmts);

                    if (this._noBinding(bodyStmts)) {
                        return { type: "raw", stmt: ast }
                    }

                    var loopStmt = { type: "loop", bodyFirst: false, bodyStmt: { type: "delay", stmts: bodyStmts } };

                    var condition = ast[1];
                    loopStmt.condition = condition;

                    return loopStmt;
                },

                "do": function (ast) {

                    var bodyStmts = [];
                    var body = ast[2];
                    this._visitBody(body, bodyStmts);

                    if (this._noBinding(bodyStmts)) {
                        return { type: "raw", stmt: ast };
                    }

                    var loopStmt = { type: "loop", bodyFirst: true, bodyStmt: { type: "delay", stmts: bodyStmts } };

                    var condition = ast[1];
                    loopStmt.condition = condition;

                    return loopStmt;
                },

                "switch": function (ast) {
                    var noBinding = true;

                    var switchStmt = { type: "switch", item: ast[1], caseStmts: [] };

                    var cases = ast[2];
                    for (var i = 0; i < cases.length; i++) {                    
                        var caseStmt = { item: cases[i][0], stmts: [] };
                        switchStmt.caseStmts.push(caseStmt);

                        var statements = this._collectCaseStatements(cases, i);
                        this._visitStatements(statements, caseStmt.stmts);
                        noBinding = noBinding && this._noBinding(caseStmt.stmts);
                    }

                    if (noBinding) {
                        return { type: "raw", stmt: ast };
                    } else {
                        return switchStmt;
                    }
                },

                "if": function (ast) {

                    var noBinding = true;

                    var ifStmt = { type: "if", conditionStmts: [] };

                    var currAst = ast;
                    while (true) {
                        var condition = currAst[1];
                        var condStmt = { cond: condition, stmts: [] };
                        ifStmt.conditionStmts.push(condStmt);

                        var thenPart = currAst[2];
                        this._visitBody(thenPart, condStmt.stmts);

                        noBinding = noBinding && this._noBinding(condStmt.stmts);

                        var elsePart = currAst[3];
                        if (elsePart && elsePart[0] == "if") {
                            currAst = elsePart;
                        } else {
                            break;
                        }
                    }
        
                    var elsePart = currAst[3];
                    if (elsePart) {
                        ifStmt.elseStmts = [];

                        this._visitBody(elsePart, ifStmt.elseStmts);
                        
                        noBinding = noBinding && this._noBinding(ifStmt.elseStmts);
                    }

                    if (noBinding) {
                        return { type: "raw", stmt: ast };
                    } else {
                        return ifStmt;
                    }
                },

                "try": function (ast, stmts) {

                    var bodyStmts = [];
                    var bodyStatements = ast[1];
                    this._visitStatements(bodyStatements, bodyStmts);

                    var noBinding = this._noBinding(bodyStmts)

                    var tryStmt = { type: "try", bodyStmt: { type: "delay", stmts: bodyStmts } };
                    
                    var catchClause = ast[2];
                    if (catchClause) {
                        var exVar = catchClause[0];
                        tryStmt.exVar = exVar;
                        tryStmt.catchStmts = [];

                        this._visitStatements(catchClause[1], tryStmt.catchStmts);

                        noBinding = noBinding && this._noBinding(tryStmt.catchStmts);
                    }

                    var finallyStatements = ast[3];
                    if (finallyStatements) {
                        tryStmt.finallyStmt = { type: "delay", stmts: [] };

                        this._visitStatements(finallyStatements, tryStmt.finallyStmt.stmts);

                        noBinding = noBinding && this._noBinding(tryStmt.finallyStmt.stmts);
                    }

                    if (noBinding) {
                        return { type: "raw", stmt: ast };
                    } else {
                        return tryStmt;
                    }
                }
            }
        }

        function CodeGenerator(builderName, binder, indent) {
            this._builderName = builderName;
            this._binder = binder;
            this._normalMode = false;
            this._indent = indent;
            this._indentLevel = 0;
            this._builderVar = "$$_builder_$$_" + (__jscex__tempVarSeed++);
        }
        CodeGenerator.prototype = {
            _write: function (s) {
                this._buffer.push(s);
                return this;
            },

            _writeLine: function (s) {
                this._write(s)._write("\n");
                return this;
            },

            _writeIndents: function () {
                for (var i = 0; i < this._indent; i++) {
                    this._write(" ");
                }

                for (var i = 0; i < this._indentLevel; i++) {
                    this._write("    ");
                }
                return this;
            },

            generate: function (params, jscexAst) {
                this._buffer = [];

                this._writeLine("(function (" + params.join(", ") + ") {");
                this._indentLevel++;

                this._writeIndents()
                    ._writeLine("var " + this._builderVar + " = Jscex.builders[" + stringify(this._builderName) + "];");

                this._writeIndents()
                    ._writeLine("return " + this._builderVar + ".Start(this,");
                this._indentLevel++;

                this._pos = { };

                this._writeIndents()
                    ._visitJscex(jscexAst)
                    ._writeLine();
                return this._buffer.join("");
            }
        };
    };
})();
