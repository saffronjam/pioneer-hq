package planner

import (
	"context"
	"fmt"
	"math"
)

// solve uses a feasible slack basis and lexicographic objectives to retain every target.
func (p *program) solve(ctx context.Context) ([]float64, error) {
	rows, cols := len(p.rows), len(p.costs[0])
	if rows == 0 {
		return make([]float64, cols), nil
	}
	if rows > 2500 || cols > 7000 {
		return nil, fmt.Errorf("linked factory network exceeds the supported calculation size (2500 balances / 7000 variables)")
	}
	counts := make([]int, cols)
	for _, row := range p.rows {
		for j, c := range row.coefficients {
			if c != 0 {
				counts[j]++
			}
		}
	}
	width := cols + 1
	table := make([]float64, rows*width)
	basis := make([]int, rows)
	basic := make([]bool, cols)
	for i, row := range p.rows {
		chosen := -1
		for j := range cols {
			if c := row.coefficients[j]; counts[j] == 1 && c != 0 && row.rhs/c >= 0 {
				chosen = j
				break
			}
		}
		if chosen < 0 {
			return nil, fmt.Errorf("material balance has no initial shortage/slack variable")
		}
		scale := row.coefficients[chosen]
		for j, c := range row.coefficients {
			table[i*width+j] = c / scale
		}
		table[i*width+cols] = row.rhs / scale
		basis[i] = chosen
		basic[chosen] = true
	}
	reduced := make([][]float64, len(p.costs))
	for stage := range reduced {
		reduced[stage] = make([]float64, cols)
	}
	for iteration := 0; iteration < 100000; iteration++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for stage := range reduced {
			copy(reduced[stage], p.costs[stage])
			for i, index := range basis {
				cost := p.costs[stage][index]
				if cost == 0 {
					continue
				}
				row := table[i*width : (i+1)*width]
				for j := range cols {
					reduced[stage][j] -= cost * row[j]
				}
			}
		}
		entering := -1
		for j := range cols {
			if basic[j] {
				continue
			}
			for stage := range reduced {
				cost := reduced[stage][j]
				if math.Abs(cost) <= 1e-9 {
					continue
				}
				if cost < 0 {
					entering = j
				}
				break
			}
			if entering >= 0 {
				break
			}
		}
		if entering < 0 {
			solution := make([]float64, cols)
			for i, index := range basis {
				solution[index] = math.Max(0, table[i*width+cols])
			}
			for _, row := range p.rows {
				sum := 0.0
				for j, c := range row.coefficients {
					sum += c * solution[j]
				}
				if !finite(sum) || math.Abs(sum-row.rhs) > 1e-5*math.Max(1, math.Abs(row.rhs)) {
					return nil, fmt.Errorf("material balance failed conservation check")
				}
			}
			return solution, nil
		}
		leaving := -1
		ratio := math.Inf(1)
		for i := range rows {
			coefficient := table[i*width+entering]
			if coefficient <= 1e-10 {
				continue
			}
			candidate := math.Max(0, table[i*width+cols]) / coefficient
			if candidate < ratio-1e-9 || math.Abs(candidate-ratio) <= 1e-9 && (leaving < 0 || basis[i] < basis[leaving]) {
				ratio = candidate
				leaving = i
			}
		}
		if leaving < 0 {
			return nil, fmt.Errorf("material balance is numerically unbounded")
		}
		pivot := table[leaving*width : (leaving+1)*width]
		scale := pivot[entering]
		for j := range width {
			pivot[j] /= scale
		}
		pivot[entering] = 1
		for i := range rows {
			if i == leaving {
				continue
			}
			row := table[i*width : (i+1)*width]
			factor := row[entering]
			if factor == 0 {
				continue
			}
			for j := range width {
				row[j] -= factor * pivot[j]
			}
			row[entering] = 0
		}
		basic[basis[leaving]] = false
		basis[leaving] = entering
		basic[entering] = true
	}
	return nil, fmt.Errorf("material balance iteration limit reached; simplify the linked factory network")
}
