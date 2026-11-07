use super::{
    dto, response::DecodedResponse, Error, PaginationBudget, MAX_JSON_BYTES,
    MAX_PAGINATED_JSON_BYTES, PAGE_SIZE,
};

fn page(
    start: usize,
    count: usize,
    total: Option<u64>,
    encoded_bytes: usize,
) -> DecodedResponse<dto::PaginatedPage<usize>> {
    DecodedResponse {
        value: dto::PaginatedPage {
            results: (start..start + count).collect(),
            total,
        },
        encoded_bytes,
    }
}

#[test]
fn pagination_rejects_aggregate_bytes_before_retaining_the_page() {
    let mut budget = PaginationBudget::default();
    let mut items = Vec::new();
    assert!(!budget
        .append_page(
            &mut items,
            page(
                0,
                PAGE_SIZE,
                Some((PAGE_SIZE * 2) as u64),
                MAX_PAGINATED_JSON_BYTES - 1
            ),
        )
        .unwrap());

    assert_eq!(
        budget
            .append_page(
                &mut items,
                page(PAGE_SIZE, PAGE_SIZE, Some((PAGE_SIZE * 2) as u64), 2),
            )
            .unwrap_err(),
        Error::server("Relution pagination exceeded the response byte limit")
    );
    assert_eq!(items.len(), PAGE_SIZE);
}

#[test]
fn short_page_is_not_final_while_total_reports_more_items() {
    let mut budget = PaginationBudget::default();
    let mut items = Vec::new();
    assert!(!budget
        .append_page(&mut items, page(0, 50, Some(230), 1))
        .unwrap());
    assert!(budget
        .append_page(&mut items, page(50, 0, Some(230), 1))
        .unwrap());
    assert!(budget
        .append_page(&mut Vec::new(), page(0, 50, None, 1))
        .unwrap());
}

#[test]
fn pagination_keeps_the_per_response_limit_within_the_aggregate_budget() {
    assert_eq!(
        PaginationBudget::default().response_limit().unwrap(),
        MAX_JSON_BYTES
    );
    assert_eq!(
        PaginationBudget {
            encoded_bytes: MAX_PAGINATED_JSON_BYTES - 1,
        }
        .response_limit()
        .unwrap(),
        1
    );
}

#[test]
fn pagination_preserves_one_hundred_full_pages_and_ten_thousand_items() {
    let mut budget = PaginationBudget::default();
    let mut items = Vec::new();
    for page_number in 0..100 {
        let complete = budget
            .append_page(
                &mut items,
                page(page_number * PAGE_SIZE, PAGE_SIZE, Some(10_000), 1),
            )
            .unwrap();
        assert_eq!(complete, page_number == 99);
    }
    assert_eq!(items, (0..10_000).collect::<Vec<_>>());
}
