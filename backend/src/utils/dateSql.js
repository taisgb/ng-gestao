function monthYearFilter(db, expression) {
    if (db.isPostgres) {
        return `TO_CHAR((${expression})::date, 'MM') = ? AND TO_CHAR((${expression})::date, 'YYYY') = ?`;
    }
    return `strftime('%m', ${expression}) = ? AND strftime('%Y', ${expression}) = ?`;
}

function yearFilter(db, expression) {
    if (db.isPostgres) {
        return `TO_CHAR((${expression})::date, 'YYYY') = ?`;
    }
    return `strftime('%Y', ${expression}) = ?`;
}

function yearMonthFilter(db, expression) {
    if (db.isPostgres) {
        return `TO_CHAR((${expression})::date, 'YYYY-MM') = ?`;
    }
    return `strftime('%Y-%m', ${expression}) = ?`;
}

module.exports = {
    monthYearFilter,
    yearFilter,
    yearMonthFilter
};
